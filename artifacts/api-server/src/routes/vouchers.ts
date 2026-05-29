import { Router } from "express";
import { eq, and, isNull, isNotNull, desc, sql, or, ilike, gte, inArray } from "drizzle-orm";
import { db, routersTable, vouchersTable, vendorsTable, scriptSalesTable } from "@workspace/db";
import {
  generateVouchers,
  listProfiles,
  enableDisableHotspotUsers,
  enableDisableHotspotUsersByComment,
} from "../lib/mikrotik.js";
import type { HotspotUser } from "../lib/mikrotik.js";
import {
  invalidateUserCache,
  appendCachedUsers,
  resolveCallerScope,
  patchCachedHotspotUsersDisabled,
  patchCachedHotspotUsersDisabledByComment,
} from "./routers.js";
import { assertRouterAccessForScope, assertVoucherAccessForScope } from "../lib/caller-router-access.js";

import { getCachedProfilePricesSync, getCachedProfilePrices } from "../lib/profile-cache.js";
import { effectiveProfilePrice } from "../lib/profile-price.js";
import { decodeRouterText } from "../lib/router-encoding.js";
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
  const scope = await resolveCallerScope(req);
  if (!scope) { res.status(401).json({ error: "Non authentifié" }); return; }

  const { routerId, profile, printed, limit, offset } = req.query as {
    routerId?: string;
    profile?: string;
    printed?: string;
    limit?: string;
    offset?: string;
  };

  const parsedRouterId = routerId ? parseInt(routerId, 10) : NaN;
  if (scope.kind === "manager" || scope.kind === "collaborateur" || scope.kind === "vendor") {
    if (!routerId || Number.isNaN(parsedRouterId)) {
      res.status(400).json({ error: "routerId requis" });
      return;
    }
    if (!(await assertRouterAccessForScope(scope, parsedRouterId, res))) return;
  } else if (routerId && !Number.isNaN(parsedRouterId)) {
    if (!(await assertRouterAccessForScope(scope, parsedRouterId, res))) return;
  }

  const conditions: ReturnType<typeof eq>[] = [];
  if (routerId && !Number.isNaN(parsedRouterId)) {
    conditions.push(eq(vouchersTable.routerId, parsedRouterId));
  } else if (scope.kind === "admin" || scope.kind === "super") {
    const adminRouters = await db
      .select({ id: routersTable.id })
      .from(routersTable)
      .where(eq(routersTable.ownerAdminId, scope.adminId));
    const ids = adminRouters.map((r) => r.id);
    if (ids.length === 0) {
      res.json({ vouchers: [], total: 0 });
      return;
    }
    conditions.push(inArray(vouchersTable.routerId, ids));
  }
  if (profile) conditions.push(eq(vouchersTable.profileName, profile));
  if (printed === "true") conditions.push(isNotNull(vouchersTable.printedAt));
  if (printed === "false") conditions.push(isNull(vouchersTable.printedAt));

  const lim = limit ? parseInt(limit, 10) : 50;
  const off = offset ? parseInt(offset, 10) : 0;
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const query = db
    .select()
    .from(vouchersTable)
    .orderBy(desc(vouchersTable.createdAt))
    .limit(lim)
    .offset(off);

  const countQuery = db.$count(vouchersTable, whereClause);

  const [vouchers, total] = await Promise.all([
    whereClause ? query.where(whereClause) : query,
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
  if (!(await assertRouterAccessForScope(scope, rid, res))) return;

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
  const knownUsernames = new Set(voucherRows.map((v) => decodeRouterText(v.username).toLowerCase()));

  const fromScripts = scriptRows
    .filter((s) => !knownUsernames.has(decodeRouterText(s.username).toLowerCase()))
    .map((s) => {
      // Décodage défensif (idempotent) — corrige les chaînes legacy mojibakées.
      const decUsername = decodeRouterText(s.username);
      const decLabel    = decodeRouterText(s.label);
      const decValidity = decodeRouterText(s.validity);
      const decBatch    = decodeRouterText(s.batch);
      return {
      id: -s.id,
      username: decUsername,
      profileName: (decLabel.trim() || decValidity.trim() || "—") as string,
      comment: decBatch.trim() || null,
      price: s.price ?? "",
      salePrice: s.price ?? null,
      macAddress: s.mac?.trim() || null,
      saleIp: s.ip?.trim() || null,
      printedAt: null as string | null,
      createdAt: s.saleDate.toISOString(),
      usedAt: s.saleDate.toISOString(),
      vendorId: null as number | null,
      vendorName: "Script MikroTik" as string | null,
    };
    });

  // Décodage défensif aussi des lignes voucher (legacy data potentiellement mojibakée).
  const decodedVouchers = voucherRows.map((v) => ({
    ...v,
    username:    decodeRouterText(v.username),
    profileName: decodeRouterText(v.profileName),
    comment:     v.comment == null ? null : decodeRouterText(v.comment),
    vendorName:  v.vendorName == null ? null : decodeRouterText(v.vendorName),
  }));

  type TicketRow = (typeof voucherRows)[number];
  const merged: TicketRow[] = [...decodedVouchers, ...fromScripts] as TicketRow[];
  merged.sort(
    (a, b) =>
      new Date(b.usedAt ?? b.printedAt ?? b.createdAt).getTime() -
      new Date(a.usedAt ?? a.printedAt ?? a.createdAt).getTime(),
  );
  const tickets = merged.slice(0, 200);

  res.json({ tickets, total: tickets.length });
});

router.post("/vouchers/generate", async (req, res): Promise<void> => {
  const scope = await resolveCallerScope(req);
  if (!scope) { res.status(401).json({ error: "Non authentifié" }); return; }
  if (scope.kind === "vendor") {
    res.status(403).json({ error: "Accès refusé" });
    return;
  }

  const { routerId, profile, qty, prefix, comment, server, vendorId, passwordMode, charType, userLength, timelimit, datalimit, profilePrice, profileValidity, lotTarget } = req.body as {
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
    /** Taille totale visée du lot (empêche les doublons après timeout / reprise). */
    lotTarget?: number;
  };

  if (!routerId || !profile || !qty) {
    res.status(400).json({ error: "routerId, profile et qty sont requis" });
    return;
  }
  if (qty < 1 || qty > 1000) {
    res.status(400).json({ error: "qty doit être entre 1 et 1000" });
    return;
  }
  if (!(await assertRouterAccessForScope(scope, routerId, res))) return;

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, routerId));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  let price = (profilePrice ?? "").trim();
  let validity = (profileValidity ?? "").trim();

  const conn = { host: r.host, port: r.port, username: r.username, password: r.password };
  try {
    const priceMap = getCachedProfilePricesSync(routerId, conn);
    if (!price) price = priceMap.get(profile) ?? "";
  } catch {
    // non-blocking
  }

  if (!price || !validity) {
    try {
      const profiles = await listProfiles(conn);
      const prof = profiles.find((p) => p.name === profile);
      if (prof) {
        if (!price) price = effectiveProfilePrice(prof);
        if (!validity) validity = prof.validity ?? "";
      }
    } catch {
      // Continue without profile metadata
    }
  }

  if (!price) {
    try {
      const priceMap = await getCachedProfilePrices(routerId, conn);
      price = priceMap.get(profile) ?? "";
    } catch {
      // non-blocking
    }
  }

  try {
    // Lock this router for the duration of generation so background syncs
    // don't open concurrent MikroTik connections and saturate the API limit.
    const responseRows = await withRouterLock(routerId, async () => {
      const parsedLotTarget =
        lotTarget != null && Number.isFinite(Number(lotTarget)) ? Math.round(Number(lotTarget)) : undefined;
      const generated = await generateVouchers(
        conn,
        {
          qty,
          profile,
          prefix,
          comment,
          server,
          price,
          validity,
          passwordMode: passwordMode ?? "same",
          charType,
          userLength,
          timelimit: timelimit || undefined,
          datalimit: datalimit || undefined,
          ...(parsedLotTarget != null && parsedLotTarget > 0 ? { lotTarget: parsedLotTarget } : {}),
        },
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
      uptime: null,
      bytesIn: null,
      bytesOut: null,
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
router.post("/vouchers/users-toggle", async (req, res): Promise<void> => {
  const scope = await resolveCallerScope(req);
  if (!scope) { res.status(401).json({ error: "Non authentifié" }); return; }
  if (scope.kind === "vendor") {
    res.status(403).json({ error: "Accès refusé" });
    return;
  }

  const { routerId, usernames, enable, skipSessionKick } = req.body as {
    routerId?: number;
    usernames?: string[];
    enable?: boolean;
    /** true = toggle lot : pas d’expulsion session ni purge cookie */
    skipSessionKick?: boolean;
  };
  if (!routerId || !Array.isArray(usernames) || usernames.length === 0) {
    res.status(400).json({ error: "routerId et usernames sont requis" });
    return;
  }
  if (!(await assertRouterAccessForScope(scope, routerId, res))) return;

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, routerId));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  try {
    const result = await withRouterLock(routerId, () =>
      enableDisableHotspotUsers(
        { host: r.host, port: r.port, username: r.username, password: r.password },
        usernames,
        enable ?? false,
        { kickSessions: !skipSessionKick },
      ),
    );
    const disabledOnRouter = !(enable ?? false);
    if (!patchCachedHotspotUsersDisabled(r.ownerAdminId, routerId, usernames, disabledOnRouter)) {
      void invalidateUserCache(routerId);
    }
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de contacter le routeur" });
  }
});

// GET /vouchers/lot-usernames — usernames en base pour un lot (`comment`), pour progression client (toggle paqueté)
router.get("/vouchers/lot-usernames", async (req, res): Promise<void> => {
  const scope = await resolveCallerScope(req);
  if (!scope) { res.status(401).json({ error: "Non authentifié" }); return; }
  if (scope.kind === "vendor") {
    res.status(403).json({ error: "Accès refusé" });
    return;
  }

  const rawRid = req.query.routerId;
  const routerId = typeof rawRid === "string" ? parseInt(rawRid, 10) : NaN;
  const commentTrim = typeof req.query.comment === "string" ? req.query.comment.trim() : "";
  if (!commentTrim || !Number.isFinite(routerId)) {
    res.status(400).json({ error: "routerId et comment sont requis" });
    return;
  }
  if (!(await assertRouterAccessForScope(scope, routerId, res))) return;

  const rows = await db
    .select({ username: vouchersTable.username })
    .from(vouchersTable)
    .where(and(eq(vouchersTable.routerId, routerId), eq(vouchersTable.comment, commentTrim)));

  res.json({ usernames: rows.map((r) => r.username) });
});

router.post("/vouchers/lot-disable", async (req, res): Promise<void> => {
  const scope = await resolveCallerScope(req);
  if (!scope) { res.status(401).json({ error: "Non authentifié" }); return; }
  if (scope.kind === "vendor") {
    res.status(403).json({ error: "Accès refusé" });
    return;
  }

  const { routerId, comment, enable } = req.body as {
    routerId?: number;
    comment?: string;
    enable?: boolean;
  };
  const commentTrim = typeof comment === "string" ? comment.trim() : "";
  if (!routerId || !commentTrim) {
    res.status(400).json({ error: "routerId et comment sont requis" });
    return;
  }
  if (!(await assertRouterAccessForScope(scope, routerId, res))) return;

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, routerId));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  const conn = { host: r.host, port: r.port, username: r.username, password: r.password };

  try {
    /** Toujours : print MikroTik `?comment=<lot>` + user/set en parallèle (jamais de liste de noms DB). */
    const result = await withRouterLock(routerId, () =>
      enableDisableHotspotUsersByComment(conn, commentTrim, enable ?? false),
    );
    const disabledOnRouter = !(enable ?? false);
    if (
      !patchCachedHotspotUsersDisabledByComment(r.ownerAdminId, routerId, commentTrim, disabledOnRouter)
    ) {
      void invalidateUserCache(routerId);
    }
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de contacter le routeur" });
  }
});

router.delete("/vouchers/:id", async (req, res): Promise<void> => {
  const scope = await resolveCallerScope(req);
  if (!scope) { res.status(401).json({ error: "Non authentifié" }); return; }
  if (scope.kind === "manager") {
    res.status(403).json({ error: "Les gérants de zone ne peuvent pas supprimer de données." });
    return;
  }
  if (scope.kind === "vendor") {
    res.status(403).json({ error: "Accès refusé" });
    return;
  }

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  if (!(await assertVoucherAccessForScope(scope, id, res))) return;

  const [deleted] = await db.delete(vouchersTable).where(eq(vouchersTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Voucher introuvable" }); return; }
  res.sendStatus(204);
});

router.post("/vouchers/:id/mark-printed", async (req, res): Promise<void> => {
  const scope = await resolveCallerScope(req);
  if (!scope) { res.status(401).json({ error: "Non authentifié" }); return; }
  if (scope.kind === "vendor") {
    res.status(403).json({ error: "Accès refusé" });
    return;
  }

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  if (!(await assertVoucherAccessForScope(scope, id, res))) return;

  const [updated] = await db
    .update(vouchersTable)
    .set({ printedAt: new Date() })
    .where(eq(vouchersTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Voucher introuvable" }); return; }
  res.json(updated);
});

export default router;
