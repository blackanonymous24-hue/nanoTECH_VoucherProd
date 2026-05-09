import { Router } from "express";
import { eq, and, isNull, isNotNull, desc, sql, or, ilike, gte } from "drizzle-orm";
import { db, routersTable, vouchersTable, vendorsTable, scriptSalesTable } from "@workspace/db";
import { generateVouchers, listProfiles, enableDisableHotspotUsers } from "../lib/mikrotik.js";
import type { HotspotUser } from "../lib/mikrotik.js";
import { invalidateUserCache, appendCachedUsers, resolveCallerScope } from "./routers.js";
import { getCachedProfilePricesSync } from "../lib/profile-cache.js";
import { withRouterLock } from "../lib/router-lock.js";

/**
 * After inserting vouchers, attribute any with vendorId=null to the matching
 * vendor if their comment ends with that vendor's commentSuffix or commentSuffix2.
 * This ensures real-time assignment even when vendorId was not explicitly passed.
 */
async function autoAttributeInserted(insertedIds: number[]) {
  if (insertedIds.length === 0) return;
  try {
    const vendors = await db
      .select({ id: vendorsTable.id, s1: vendorsTable.commentSuffix, s2: vendorsTable.commentSuffix2 })
      .from(vendorsTable)
      .where(sql`${vendorsTable.commentSuffix} IS NOT NULL OR ${vendorsTable.commentSuffix2} IS NOT NULL`);

    for (const v of vendors) {
      const suffixes = [v.s1, v.s2].filter(Boolean) as string[];
      for (const suffix of suffixes) {
        await db
          .update(vouchersTable)
          .set({ vendorId: v.id })
          .where(
            and(
              sql`${vouchersTable.id} = ANY(ARRAY[${sql.raw(insertedIds.join(","))}]::int[])`,
              isNull(vouchersTable.vendorId),
              sql`${vouchersTable.comment} LIKE ${"%" + suffix}`,
            ),
          );
      }
    }
  } catch {
    // non-blocking
  }
}

const router = Router();

router.get("/vouchers", async (req, res): Promise<void> => {
  const { routerId, profile, printed, limit, offset } = req.query as {
    routerId?: string;
    profile?: string;
    printed?: string;
    limit?: string;
    offset?: string;
  };

  const conditions = [];
  if (routerId) conditions.push(eq(vouchersTable.routerId, parseInt(routerId, 10)));
  if (profile) conditions.push(eq(vouchersTable.profileName, profile));
  if (printed === "true") conditions.push(isNotNull(vouchersTable.printedAt));
  if (printed === "false") conditions.push(isNull(vouchersTable.printedAt));

  const lim = limit ? parseInt(limit, 10) : 50;
  const off = offset ? parseInt(offset, 10) : 0;

  const query = db
    .select()
    .from(vouchersTable)
    .orderBy(desc(vouchersTable.createdAt))
    .limit(lim)
    .offset(off);

  const countQuery = db.$count(vouchersTable, conditions.length > 0 ? and(...conditions) : undefined);

  const [vouchers, total] = await Promise.all([
    conditions.length > 0 ? query.where(and(...conditions)) : query,
    countQuery,
  ]);

  res.json({ vouchers, total });
});

/* ── Ticket lookup (sold + unsold, 90 days) ──────────────────────────────
 * Lecture **uniquement en base locale** : vouchers (stock / ventes app) +
 * mikrotik_script_sales (même cache que GET …/sales-report, alimenté par la synchro
 * planifiée / vendeurs). Aucun appel MikroTik ici — évite de bloquer le routeur et
 * les autres écrans au rafraîchissement.
 * Authentification + même périmètre routeur que le reste de l’API. */
router.get("/vouchers/sold-lookup", async (req, res): Promise<void> => {
  const scope = await resolveCallerScope(req);
  if (!scope) { res.status(401).json({ error: "Non authentifié" }); return; }

  const { routerId, q } = req.query as { routerId?: string; q?: string };
  if (!routerId) { res.status(400).json({ error: "routerId requis" }); return; }

  const rid = parseInt(routerId, 10);
  if (Number.isNaN(rid)) { res.status(400).json({ error: "routerId invalide" }); return; }

  if (scope.kind === "admin" || scope.kind === "super") {
    const [own] = await db
      .select({ owner: routersTable.ownerAdminId })
      .from(routersTable)
      .where(eq(routersTable.id, rid));
    if (!own) { res.status(404).json({ error: "Routeur introuvable" }); return; }
    if (own.owner == null || own.owner !== scope.adminId) {
      res.status(403).json({ error: "Accès refusé à ce routeur" });
      return;
    }
  } else {
    if (!scope.routerIds.includes(rid)) {
      res.status(403).json({ error: "Accès refusé à ce routeur" });
      return;
    }
  }

  const [routerExists] = await db.select({ id: routersTable.id }).from(routersTable).where(eq(routersTable.id, rid));
  if (!routerExists) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  const term = (q ?? "").trim();
  if (term.length < 1) {
    res.status(400).json({ error: "Saisissez au moins un caractère de recherche (q)" });
    return;
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  cutoff.setHours(0, 0, 0, 0);

  const baseConditions = [
    eq(vouchersTable.routerId, rid),
    or(
      gte(vouchersTable.usedAt, cutoff),
      isNull(vouchersTable.usedAt),
    ),
  ];

  const searchConditions = [
    or(
      ilike(vouchersTable.username, `%${term}%`),
      ilike(vouchersTable.macAddress, `%${term}%`),
      ilike(vouchersTable.saleIp, `%${term}%`),
      ilike(vouchersTable.comment, `%${term}%`),
    ),
  ];

  const scriptWhere = and(
    eq(scriptSalesTable.routerId, rid),
    gte(scriptSalesTable.saleDate, cutoff),
    or(
      ilike(scriptSalesTable.username, `%${term}%`),
      ilike(scriptSalesTable.mac, `%${term}%`),
      ilike(scriptSalesTable.ip, `%${term}%`),
      ilike(scriptSalesTable.batch, `%${term}%`),
      ilike(scriptSalesTable.label, `%${term}%`),
      ilike(scriptSalesTable.validity, `%${term}%`),
      ilike(scriptSalesTable.rawName, `%${term}%`),
    ),
  );

  const [voucherRows, scriptRows] = await Promise.all([
    db
      .select({
        id:          vouchersTable.id,
        username:    vouchersTable.username,
        profileName: vouchersTable.profileName,
        price:       vouchersTable.price,
        salePrice:   vouchersTable.salePrice,
        macAddress:  vouchersTable.macAddress,
        saleIp:      vouchersTable.saleIp,
        comment:     vouchersTable.comment,
        printedAt:   vouchersTable.printedAt,
        createdAt:   vouchersTable.createdAt,
        usedAt:      vouchersTable.usedAt,
        vendorId:    vouchersTable.vendorId,
        vendorName:  vendorsTable.name,
      })
      .from(vouchersTable)
      .leftJoin(vendorsTable, eq(vouchersTable.vendorId, vendorsTable.id))
      .where(and(...baseConditions, ...searchConditions))
      .orderBy(desc(sql`coalesce(${vouchersTable.usedAt}, ${vouchersTable.printedAt}, ${vouchersTable.createdAt})`))
      .limit(200),
    db
      .select({
        id:       scriptSalesTable.id,
        username: scriptSalesTable.username,
        saleDate: scriptSalesTable.saleDate,
        price:    scriptSalesTable.price,
        ip:       scriptSalesTable.ip,
        mac:      scriptSalesTable.mac,
        validity: scriptSalesTable.validity,
        label:    scriptSalesTable.label,
        batch:    scriptSalesTable.batch,
      })
      .from(scriptSalesTable)
      .where(scriptWhere)
      .orderBy(desc(scriptSalesTable.saleDate))
      .limit(200),
  ]);

  // Usernames already tracked via the vendors table — script entries for
  // these are duplicates and must be excluded to avoid double-listing.
  const knownUsernames = new Set(voucherRows.map((v) => v.username.toLowerCase()));

  const fromScripts = scriptRows
    .filter((s) => !knownUsernames.has(s.username.toLowerCase()))
    .map((s) => ({
      id: -s.id,
      username: s.username,
      profileName: (s.label?.trim() || s.validity?.trim() || "—") as string,
      comment: s.batch?.trim() || null,
      price: s.price ?? "",
      salePrice: s.price ?? null,
      macAddress: s.mac?.trim() || null,
      saleIp: s.ip?.trim() || null,
      printedAt: null as string | null,
      createdAt: s.saleDate.toISOString(),
      usedAt: s.saleDate.toISOString(),
      vendorId: null as number | null,
      vendorName: "Script MikroTik" as string | null,
    }));

  type TicketRow = (typeof voucherRows)[number];
  const merged: TicketRow[] = [...voucherRows, ...fromScripts] as TicketRow[];
  merged.sort(
    (a, b) =>
      new Date(b.usedAt ?? b.printedAt ?? b.createdAt).getTime() -
      new Date(a.usedAt ?? a.printedAt ?? a.createdAt).getTime(),
  );
  const tickets = merged.slice(0, 200);

  res.json({ tickets, total: tickets.length });
});

router.post("/vouchers/generate", async (req, res): Promise<void> => {
  const { routerId, profile, qty, prefix, comment, server, vendorId, passwordMode, charType, userLength, timelimit, datalimit, profilePrice, profileValidity } = req.body as {
    routerId?: number;
    profile?: string;
    qty?: number;
    prefix?: string;
    comment?: string;
    server?: string;
    vendorId?: number | null;
    passwordMode?: "same" | "random";
    charType?: "lower" | "upper" | "upplow" | "mix" | "mix1" | "mix2" | "num";
    userLength?: number;
    timelimit?: string;
    datalimit?: number;
    profilePrice?: string;
    profileValidity?: string;
  };

  if (!routerId || !profile || !qty) {
    res.status(400).json({ error: "routerId, profile et qty sont requis" });
    return;
  }
  if (qty < 1 || qty > 1000) {
    res.status(400).json({ error: "qty doit être entre 1 et 1000" });
    return;
  }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, routerId));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  let price = profilePrice ?? "";
  let validity = profileValidity ?? "";

  // Fast path: read price from in-memory cache and trigger background refresh if stale.
  const conn = { host: r.host, port: r.port, username: r.username, password: r.password };
  try {
    const priceMap = getCachedProfilePricesSync(routerId, conn);
    price = priceMap.get(profile) ?? "";
  } catch {
    // non-blocking
  }

  // If not provided by frontend, resolve from MikroTik once (best effort).
  if (!price || !validity) {
    try {
      const profiles = await listProfiles(conn);
      const prof = profiles.find((p) => p.name === profile);
      if (prof) {
        if (!price) price = prof.price ?? "";
        if (!validity) validity = prof.validity ?? "";
      }
    } catch {
      // Continue without profile metadata
    }
  }

  try {
    // Lock this router for the duration of generation so background syncs
    // don't open concurrent MikroTik connections and saturate the API limit.
    const responseRows = await withRouterLock(routerId, async () => {
      const generated = await generateVouchers(
        conn,
        { qty, profile, prefix, comment, server, price, validity, passwordMode: passwordMode ?? "same", charType, userLength, timelimit: timelimit || undefined, datalimit: datalimit || undefined },
      );
      const insertedIds = await db
        .insert(vouchersTable)
        .values(
          generated.map((v) => ({
            routerId,
            vendorId: vendorId ?? null,
            username: v.username,
            password: v.password,
            profileName: v.profile,
            price: v.price,
            validity: v.validity,
            comment: v.comment || null,
          })),
        )
        .returning({ id: vouchersTable.id });
      return generated.map((v, i) => ({
        id: insertedIds[i]?.id ?? 0,
        routerId,
        vendorId: vendorId ?? null,
        username: v.username,
        password: v.password,
        profileName: v.profile,
        price: v.price,
        validity: v.validity,
        comment: v.comment || null,
        printedAt: null,
        usedAt: null,
        createdAt: new Date().toISOString(),
      }));
    });

    // Respond immediately — do not block on cache work.
    res.status(201).json(responseRows);

    // Inject the freshly-generated users into the in-memory cache so that the
    // next /users or /lots request (e.g. the lot reload after generation) is
    // served instantly from memory — no MikroTik round-trip needed.
    // If the cache is empty (cold start), this is a no-op and the next request
    // will warm the cache from MikroTik as usual.
    const newHotspotUsers: HotspotUser[] = responseRows.map((v) => ({
      username: v.username,
      password: v.password,
      profile: v.profileName,
      comment: v.comment ?? null,
      limitUptime: timelimit || null,
      limitBytesTotal: datalimit ? String(datalimit) : null,
      macAddress: null,
      server: server || null,
      disabled: false,
    }));
    appendCachedUsers(routerId, r.ownerAdminId, newHotspotUsers);

    // Background: auto-attribute vouchers without vendorId to the matching vendor by comment suffix
    void autoAttributeInserted(responseRows.map((v) => v.id));
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de contacter le routeur" });
  }
});

// POST /vouchers/users-toggle — enable/disable a specific set of usernames
/**
 * GET /vouchers/lot-usernames?routerId=&comment=
 * Liste des noms d'utilisateur (DB) pour un lot — utilisé pour désactiver par lots
 * avec progression côté client sans charger tout en une seule requête MikroTik.
 */
router.get("/vouchers/lot-usernames", async (req, res): Promise<void> => {
  const { routerId, comment } = req.query as { routerId?: string; comment?: string };
  if (!routerId || comment == null || comment === "") {
    res.status(400).json({ error: "routerId et comment sont requis" });
    return;
  }
  const rid = parseInt(routerId, 10);
  if (Number.isNaN(rid)) {
    res.status(400).json({ error: "routerId invalide" });
    return;
  }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, rid));
  if (!r) {
    res.status(404).json({ error: "Routeur introuvable" });
    return;
  }

  const rows = await db
    .select({ username: vouchersTable.username })
    .from(vouchersTable)
    .where(and(eq(vouchersTable.routerId, rid), eq(vouchersTable.comment, comment)));

  res.json({ usernames: rows.map((x) => x.username) });
});

router.post("/vouchers/users-toggle", async (req, res): Promise<void> => {
  const { routerId, usernames, enable } = req.body as {
    routerId?: number;
    usernames?: string[];
    enable?: boolean;
  };
  if (!routerId || !Array.isArray(usernames) || usernames.length === 0) {
    res.status(400).json({ error: "routerId et usernames sont requis" });
    return;
  }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, routerId));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  try {
    const result = await withRouterLock(routerId, () =>
      enableDisableHotspotUsers(
        { host: r.host, port: r.port, username: r.username, password: r.password },
        usernames,
        enable ?? false,
      ),
    );
    await invalidateUserCache(routerId);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de contacter le routeur" });
  }
});

router.post("/vouchers/lot-disable", async (req, res): Promise<void> => {
  const { routerId, comment, enable } = req.body as {
    routerId?: number;
    comment?: string;
    enable?: boolean;
  };
  if (!routerId || !comment) {
    res.status(400).json({ error: "routerId et comment sont requis" });
    return;
  }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, routerId));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  const vouchers = await db
    .select({ username: vouchersTable.username })
    .from(vouchersTable)
    .where(and(eq(vouchersTable.routerId, routerId), eq(vouchersTable.comment, comment)));

  if (vouchers.length === 0) {
    res.json({ done: 0, notFound: [] });
    return;
  }

  try {
    const usernames = vouchers.map((v) => v.username);
    const result = await withRouterLock(routerId, () =>
      enableDisableHotspotUsers(
        { host: r.host, port: r.port, username: r.username, password: r.password },
        usernames,
        enable ?? false,
      ),
    );
    await invalidateUserCache(routerId);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de contacter le routeur" });
  }
});

router.delete("/vouchers/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [deleted] = await db.delete(vouchersTable).where(eq(vouchersTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Voucher introuvable" }); return; }
  res.sendStatus(204);
});

router.post("/vouchers/:id/mark-printed", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [updated] = await db
    .update(vouchersTable)
    .set({ printedAt: new Date() })
    .where(eq(vouchersTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Voucher introuvable" }); return; }
  res.json(updated);
});

export default router;
