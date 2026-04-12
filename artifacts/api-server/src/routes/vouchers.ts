import { Router } from "express";
import { eq, and, isNotNull, isNull, desc, sql, or, ilike, gte } from "drizzle-orm";
import { db, routersTable, vouchersTable, vendorsTable } from "@workspace/db";
import { generateVouchers, listProfiles, enableDisableHotspotUsers } from "../lib/mikrotik.js";
import { invalidateUserCache } from "./routers.js";
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

/* ── Sold-ticket lookup (admin/manager/collab) ─────────────────────────── */
router.get("/vouchers/sold-lookup", async (req, res): Promise<void> => {
  const { routerId, q } = req.query as { routerId?: string; q?: string };
  if (!routerId) { res.status(400).json({ error: "routerId requis" }); return; }

  const rid = parseInt(routerId, 10);
  const term = (q ?? "").trim();

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  cutoff.setHours(0, 0, 0, 0);

  const baseConditions = [
    eq(vouchersTable.routerId, rid),
    isNotNull(vouchersTable.printedAt),
    gte(vouchersTable.printedAt, cutoff),
  ];

  const searchConditions = term.length >= 1
    ? [or(
        ilike(vouchersTable.username, `%${term}%`),
        ilike(vouchersTable.macAddress, `%${term}%`),
        ilike(vouchersTable.saleIp, `%${term}%`),
      )]
    : [];

  const rows = await db
    .select({
      id:          vouchersTable.id,
      username:    vouchersTable.username,
      profileName: vouchersTable.profileName,
      price:       vouchersTable.price,
      salePrice:   vouchersTable.salePrice,
      macAddress:  vouchersTable.macAddress,
      saleIp:      vouchersTable.saleIp,
      printedAt:   vouchersTable.printedAt,
      usedAt:      vouchersTable.usedAt,
      vendorId:    vouchersTable.vendorId,
      vendorName:  vendorsTable.name,
    })
    .from(vouchersTable)
    .leftJoin(vendorsTable, eq(vouchersTable.vendorId, vendorsTable.id))
    .where(and(...baseConditions, ...searchConditions))
    .orderBy(desc(vouchersTable.printedAt))
    .limit(200);

  res.json({ tickets: rows, total: rows.length });
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
    const inserted = await withRouterLock(routerId, async () => {
      const generated = await generateVouchers(
        conn,
        { qty, profile, prefix, comment, server, price, validity, passwordMode: passwordMode ?? "same", charType, userLength, timelimit: timelimit || undefined, datalimit: datalimit || undefined },
      );
      return db
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
        .returning();
    });

    res.status(201).json(inserted);

    // Background: auto-attribute vouchers without vendorId to the matching vendor by comment suffix
    void autoAttributeInserted(inserted.map((v) => v.id));
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de contacter le routeur" });
  }
});

// POST /vouchers/users-toggle — enable/disable a specific set of usernames
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
    invalidateUserCache(routerId);
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
    invalidateUserCache(routerId);
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
