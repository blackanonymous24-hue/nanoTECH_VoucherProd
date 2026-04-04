import { Router } from "express";
import { eq, desc, and, count, sql, isNotNull, ilike, inArray } from "drizzle-orm";
import { db, vendorsTable, vouchersTable, routersTable } from "@workspace/db";
import { hashPassword } from "../lib/vendor-auth.js";
import { enableDisableHotspotUsers, type RouterConnection } from "../lib/mikrotik.js";
import { getCachedProfilePrices, getCachedProfilePricesSync } from "../lib/profile-cache.js";
import { buildProfilePeriodCounts, computeSalesStats } from "../lib/sales-stats.js";
import { logger } from "../lib/logger.js";
import { syncMikrotikUsersToVendor } from "../lib/vendor-sync.js";

const router = Router();

function buildTotals(vendorId: number) {
  return db.select({
    total:   count(),
    printed: sql<number>`count(*) filter (where ${vouchersTable.printedAt} is not null)`,
    used:    sql<number>`count(*) filter (where ${vouchersTable.usedAt} is not null)`,
  })
  .from(vouchersTable)
  .where(eq(vouchersTable.vendorId, vendorId));
}


function safeVendor(v: typeof vendorsTable.$inferSelect) {
  const { passwordHash: _ph, ...rest } = v;
  return rest;
}

/** Attribute existing vouchers whose comment ends with commentSuffix to the vendor.
 *  Updates ALL matching rows on the vendor's router, regardless of current vendorId,
 *  so pre-existing tickets and wrongly-assigned tickets are both fixed. */
async function attributeVouchersBySuffix(vendorId: number, routerId: number, commentSuffix: string) {
  if (!commentSuffix || !commentSuffix.trim()) return;
  const suffix = commentSuffix.trim();
  try {
    const result = await db
      .update(vouchersTable)
      .set({ vendorId })
      .where(
        and(
          eq(vouchersTable.routerId, routerId),
          sql`${vouchersTable.comment} LIKE ${'%' + suffix}`,
          sql`(${vouchersTable.vendorId} IS NULL OR ${vouchersTable.vendorId} != ${vendorId})`,
        )
      )
      .returning({ id: vouchersTable.id });
    if (result.length > 0) {
      logger.info({ vendorId, routerId, suffix, count: result.length }, "vouchers attributed by comment suffix");
    }
  } catch (err) {
    logger.warn({ vendorId, routerId, suffix, err }, "failed to attribute vouchers by suffix");
  }
}

router.get("/vendors", async (req, res): Promise<void> => {
  const routerId = req.query.routerId ? parseInt(req.query.routerId as string, 10) : null;
  const vendors = await db
    .select()
    .from(vendorsTable)
    .where(routerId ? eq(vendorsTable.routerId, routerId) : undefined)
    .orderBy(vendorsTable.name);
  res.json(vendors.map(safeVendor));
});

router.post("/vendors", async (req, res): Promise<void> => {
  const { name, phone, email, username, password, routerId, commentSuffix, commentSuffix2 } = req.body as {
    name?: string;
    phone?: string;
    email?: string;
    username?: string;
    password?: string;
    routerId?: number;
    commentSuffix?: string;
    commentSuffix2?: string;
  };

  if (!name || name.trim() === "") {
    res.status(400).json({ error: "Le nom du vendeur est requis" });
    return;
  }

  // If username not provided, fall back to phone number
  const resolvedUsername = username?.trim() || phone?.trim() || null;

  if (resolvedUsername) {
    const [existing] = await db
      .select({ id: vendorsTable.id })
      .from(vendorsTable)
      .where(eq(vendorsTable.username, resolvedUsername));
    if (existing) {
      res.status(400).json({ error: "Ce nom d'utilisateur est déjà pris" });
      return;
    }
  }

  let passwordHash: string | null = null;
  if (password && password.trim()) {
    if (password.length < 4) {
      res.status(400).json({ error: "Le mot de passe doit comporter au moins 4 caractères" });
      return;
    }
    passwordHash = await hashPassword(password);
  }

  const [vendor] = await db
    .insert(vendorsTable)
    .values({
      routerId: routerId ?? null,
      name: name.trim().toUpperCase(),
      phone: phone?.trim() || null,
      email: email?.trim() || null,
      username: resolvedUsername,
      passwordHash,
      commentSuffix: commentSuffix?.trim() || null,
      commentSuffix2: commentSuffix2?.trim() || null,
    })
    .returning();
  res.status(201).json(safeVendor(vendor));

  // Background: attribute local DB vouchers + import MikroTik users by suffix
  if (vendor.routerId && vendor.commentSuffix) void attributeVouchersBySuffix(vendor.id, vendor.routerId, vendor.commentSuffix);
  if (vendor.routerId && vendor.commentSuffix2) void attributeVouchersBySuffix(vendor.id, vendor.routerId, vendor.commentSuffix2);
  if (vendor.routerId) {
    const suffixes = [vendor.commentSuffix, vendor.commentSuffix2].filter(Boolean) as string[];
    void syncMikrotikUsersToVendor(vendor.id, vendor.routerId, suffixes, true); // force on creation
  }
});

router.put("/vendors/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const { name, phone, email, username, password, isActive, commentSuffix, commentSuffix2 } = req.body as {
    name?: string;
    phone?: string;
    email?: string;
    username?: string;
    password?: string;
    isActive?: boolean;
    commentSuffix?: string;
    commentSuffix2?: string;
  };

  // Fetch current vendor early (needed for username fallback)
  const [current] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, id));
  if (!current) { res.status(404).json({ error: "Vendeur introuvable" }); return; }

  // If username is being set to empty, fall back to phone (new or current)
  let resolvedUsername: string | null | undefined = undefined;
  if (username !== undefined) {
    resolvedUsername = username.trim() || phone?.trim() || current.phone || null;
  }

  if (resolvedUsername) {
    const [existing] = await db
      .select({ id: vendorsTable.id })
      .from(vendorsTable)
      .where(eq(vendorsTable.username, resolvedUsername));
    if (existing && existing.id !== id) {
      res.status(400).json({ error: "Ce nom d'utilisateur est déjà pris" });
      return;
    }
  }

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name.trim().toUpperCase();
  if (phone !== undefined) updates.phone = phone?.trim() || null;
  if (email !== undefined) updates.email = email?.trim() || null;
  if (resolvedUsername !== undefined) updates.username = resolvedUsername;
  if (isActive !== undefined) updates.isActive = isActive;
  if (commentSuffix !== undefined) updates.commentSuffix = commentSuffix?.trim() || null;
  if (commentSuffix2 !== undefined) updates.commentSuffix2 = commentSuffix2?.trim() || null;

  if (password !== undefined && password.trim()) {
    if (password.length < 4) {
      res.status(400).json({ error: "Le mot de passe doit comporter au moins 4 caractères" });
      return;
    }
    updates.passwordHash = await hashPassword(password);
  }

  const [vendor] = await db
    .update(vendorsTable)
    .set(updates)
    .where(eq(vendorsTable.id, id))
    .returning();

  if (!vendor) { res.status(404).json({ error: "Vendeur introuvable" }); return; }
  res.json(safeVendor(vendor));

  // Background: attribute existing vouchers by suffixes if they changed,
  // and also import matching MikroTik users into local DB
  if (vendor.routerId && vendor.commentSuffix && vendor.commentSuffix !== current.commentSuffix) {
    void attributeVouchersBySuffix(vendor.id, vendor.routerId, vendor.commentSuffix);
  }
  if (vendor.routerId && vendor.commentSuffix2 && vendor.commentSuffix2 !== current.commentSuffix2) {
    void attributeVouchersBySuffix(vendor.id, vendor.routerId, vendor.commentSuffix2);
  }
  if (vendor.routerId) {
    const suffixes = [vendor.commentSuffix, vendor.commentSuffix2].filter(Boolean) as string[];
    if (suffixes.length > 0) void syncMikrotikUsersToVendor(vendor.id, vendor.routerId, suffixes, true); // force on update
  }

  // If isActive changed, enable/disable all vouchers on MikroTik (background)
  if (isActive !== undefined && isActive !== current.isActive) {
    const enable = isActive;
    (async () => {
      try {
        const vouchers = await db
          .select({
            username: vouchersTable.username,
            routerId: vouchersTable.routerId,
          })
          .from(vouchersTable)
          .where(eq(vouchersTable.vendorId, id));

        const byRouter = new Map<number, string[]>();
        for (const v of vouchers) {
          const list = byRouter.get(v.routerId) ?? [];
          list.push(v.username);
          byRouter.set(v.routerId, list);
        }

        for (const [routerId, usernames] of byRouter) {
          const [routerRow] = await db
            .select()
            .from(routersTable)
            .where(eq(routersTable.id, routerId));
          if (!routerRow) continue;

          try {
            const result = await enableDisableHotspotUsers(
              {
                host: routerRow.host,
                port: routerRow.port,
                username: routerRow.username,
                password: routerRow.password,
              },
              usernames,
              enable,
            );
            logger.info({ vendorId: id, routerId, enable, ...result }, "vendor vouchers toggled on MikroTik");
          } catch (err) {
            logger.warn({ vendorId: id, routerId, enable, err }, "failed to toggle vouchers on MikroTik");
          }
        }
      } catch (err) {
        logger.error({ vendorId: id, err }, "background enable/disable task failed");
      }
    })();
  }
});

router.post("/vendors/:id/sync", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, id));
  if (!vendor) { res.status(404).json({ error: "Vendeur introuvable" }); return; }

  res.json({ ok: true, message: "Synchronisation démarrée" });

  // Background: attribute existing DB vouchers + re-import from MikroTik
  if (vendor.routerId && vendor.commentSuffix) void attributeVouchersBySuffix(vendor.id, vendor.routerId, vendor.commentSuffix);
  if (vendor.routerId && vendor.commentSuffix2) void attributeVouchersBySuffix(vendor.id, vendor.routerId, vendor.commentSuffix2);
  if (vendor.routerId) {
    const suffixes = [vendor.commentSuffix, vendor.commentSuffix2].filter(Boolean) as string[];
    if (suffixes.length > 0) void syncMikrotikUsersToVendor(vendor.id, vendor.routerId, suffixes, true);
  }
});

router.delete("/vendors/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [deleted] = await db
    .delete(vendorsTable)
    .where(eq(vendorsTable.id, id))
    .returning();

  if (!deleted) { res.status(404).json({ error: "Vendeur introuvable" }); return; }
  res.sendStatus(204);
});

router.get("/vendors/reports/summary", async (req, res): Promise<void> => {
  const routerId = req.query.routerId ? parseInt(req.query.routerId as string, 10) : null;
  const vendors = await db
    .select()
    .from(vendorsTable)
    .where(routerId ? eq(vendorsTable.routerId, routerId) : undefined)
    .orderBy(vendorsTable.name);

  // Fetch profile prices for all unique routers — sync (non-blocking): returns
  // in-memory cached value immediately and triggers a background MikroTik refresh.
  const routerIdSet = new Set(vendors.map((v) => v.routerId).filter(Boolean) as number[]);
  const routerPriceMaps = new Map<number, Map<string, string>>();
  const routerRows = routerIdSet.size > 0
    ? await db.select().from(routersTable).where(inArray(routersTable.id, [...routerIdSet]))
    : [];
  for (const routerRow of routerRows) {
    const conn: RouterConnection = { host: routerRow.host, port: routerRow.port, username: routerRow.username, password: routerRow.password };
    routerPriceMaps.set(routerRow.id, getCachedProfilePricesSync(routerRow.id, conn));
  }

  const summaries = await Promise.all(
    vendors.map(async (vendor) => {
      const [[row], profileCounts] = await Promise.all([
        buildTotals(vendor.id),
        buildProfilePeriodCounts(vendor.id),
      ]);

      const priceMap = (vendor.routerId ? routerPriceMaps.get(vendor.routerId) : undefined) ?? new Map<string, string>();
      const salesStats = computeSalesStats(profileCounts, priceMap);

      return {
        vendor: safeVendor(vendor),
        totalVouchers: row?.total        ?? 0,
        totalPrinted:  Number(row?.printed ?? 0),
        totalUsed:     Number(row?.used    ?? 0),
        salesStats,
      };
    }),
  );

  res.json(summaries);
});

router.get("/vendors/:id/report", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [vendor] = await db
    .select()
    .from(vendorsTable)
    .where(eq(vendorsTable.id, id));

  if (!vendor) { res.status(404).json({ error: "Vendeur introuvable" }); return; }

  // Fetch the vendor's router to get profile prices from MikroTik
  const [router] = vendor.routerId
    ? await db.select().from(routersTable).where(eq(routersTable.id, vendor.routerId))
    : [];

  const [totalsRows, byProfileRaw, profilePeriodCounts, recentVouchers] = await Promise.all([
    buildTotals(id),

    db
      .select({
        profileName: vouchersTable.profileName,
        total: count(),
        printed: sql<number>`count(*) filter (where ${vouchersTable.printedAt} is not null)`,
        used:    sql<number>`count(*) filter (where ${vouchersTable.usedAt} is not null)`,
      })
      .from(vouchersTable)
      .where(eq(vouchersTable.vendorId, id))
      .groupBy(vouchersTable.profileName)
      .orderBy(desc(count())),

    buildProfilePeriodCounts(id),

    db
      .select()
      .from(vouchersTable)
      .where(and(eq(vouchersTable.vendorId, id), isNotNull(vouchersTable.usedAt)))
      .orderBy(desc(vouchersTable.usedAt))
      .limit(50),
  ]);

  // Fetch profile prices from MikroTik cache — authoritative source for amounts
  let priceMap = new Map<string, string>();
  if (router) {
    const conn: RouterConnection = { host: router.host, port: router.port, username: router.username, password: router.password };
    priceMap = await getCachedProfilePrices(vendor.routerId!, conn);
  }
  // Merge week sales per profile so the frontend gauge can show current-week activity
  const weekCountMap = new Map(profilePeriodCounts.map((r) => [r.profileName, Number(r.weekSold)]));
  const byProfile = byProfileRaw.map((row) => ({
    ...row,
    price:    priceMap.get(row.profileName) ?? "",
    weekSold: weekCountMap.get(row.profileName) ?? 0,
  }));

  const totals = totalsRows[0];
  const salesStats = computeSalesStats(profilePeriodCounts, priceMap);

  // Enrich recentVouchers: use salePrice (from sync), else price (from generation), else profile cache
  const enrichedRecentVouchers = recentVouchers.map((v) => ({
    ...v,
    price: v.salePrice || v.price || priceMap.get(v.profileName) || "",
  }));

  res.json({
    vendor: safeVendor(vendor),
    totalVouchers: totals?.total        ?? 0,
    totalPrinted:  Number(totals?.printed ?? 0),
    totalUsed:     Number(totals?.used    ?? 0),
    salesStats,
    byProfile,
    recentVouchers: enrichedRecentVouchers,
  });
});

/* ─────────────────────────────────────────────────────────────────
 * GET /vendors/daily-tracking?date=YYYY-MM-DD&routerId=X
 * Returns per-vendor sold-voucher list + summary for a given day.
 * date defaults to yesterday (UTC).
 * ──────────────────────────────────────────────────────────────── */
router.get("/vendors/daily-tracking", async (req, res): Promise<void> => {
  const routerId = req.query.routerId ? parseInt(req.query.routerId as string, 10) : null;
  if (!routerId || isNaN(routerId)) {
    res.status(400).json({ error: "routerId requis" });
    return;
  }

  // Parse date — default to yesterday UTC
  let dateStr = (req.query.date as string) ?? "";
  let dayStart: Date;
  let dayEnd: Date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    dayStart = new Date(dateStr + "T00:00:00.000Z");
    dayEnd   = new Date(dateStr + "T23:59:59.999Z");
  } else {
    const now = new Date();
    const y = now.getUTCFullYear(), m = now.getUTCMonth(), d = now.getUTCDate();
    dayStart = new Date(Date.UTC(y, m, d - 1, 0, 0, 0, 0));
    dayEnd   = new Date(Date.UTC(y, m, d - 1, 23, 59, 59, 999));
    dateStr  = dayStart.toISOString().slice(0, 10);
  }

  // Fetch router for priceMap
  const [routerRow] = await db.select().from(routersTable).where(eq(routersTable.id, routerId));
  if (!routerRow) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  const conn: RouterConnection = {
    host: routerRow.host, port: routerRow.port,
    username: routerRow.username, password: routerRow.password,
  };
  const priceMap = getCachedProfilePricesSync(routerId, conn);
  // Case-insensitive fallback: priceMap keys are canonical MikroTik names,
  // DB profileName may differ in case or trailing 's' (e.g. "3-Heures" vs "3-Heure")
  const priceMapLower = new Map(
    [...priceMap.entries()].map(([k, v]) => [k.toLowerCase(), v]),
  );
  function resolveUnitPrice(profileName: string): number {
    const raw = priceMap.get(profileName) ?? priceMapLower.get(profileName.toLowerCase()) ?? "0";
    return parseFloat(raw.replace(/[^0-9.]/g, "")) || 0;
  }

  // Fetch vendors for this router
  const vendors = await db
    .select()
    .from(vendorsTable)
    .where(eq(vendorsTable.routerId, routerId))
    .orderBy(vendorsTable.name);

  // Fetch all sold vouchers for the day (across all vendors on this router)
  const sold = await db
    .select({
      id:          vouchersTable.id,
      username:    vouchersTable.username,
      profileName: vouchersTable.profileName,
      salePrice:   vouchersTable.salePrice,
      price:       vouchersTable.price,
      usedAt:      vouchersTable.usedAt,
      vendorId:    vouchersTable.vendorId,
      saleIp:      vouchersTable.saleIp,
      macAddress:  vouchersTable.macAddress,
    })
    .from(vouchersTable)
    .where(
      and(
        eq(vouchersTable.routerId, routerId),
        isNotNull(vouchersTable.usedAt),
        sql`${vouchersTable.usedAt} >= ${dayStart.toISOString()}`,
        sql`${vouchersTable.usedAt} <= ${dayEnd.toISOString()}`,
      ),
    )
    .orderBy(vouchersTable.usedAt);

  // Build vendor lookup
  const vendorMap = new Map(vendors.map((v) => [v.id, v]));

  // Enrich each voucher — resolve amount via priceMap when salePrice/price missing.
  // Use case-insensitive lookup to handle DB names like "3-Heures" vs MikroTik "3-Heure".
  const enriched = sold.map((v) => {
    const rawAmount = parseFloat(v.salePrice || v.price || "0") || 0;
    const unitPrice = resolveUnitPrice(v.profileName);
    const amount    = Math.max(rawAmount, unitPrice);
    const vendorName = v.vendorId ? (vendorMap.get(v.vendorId)?.name ?? "Inconnu") : "Sans vendeur";
    const usedAtObj  = v.usedAt ? new Date(v.usedAt) : null;
    return {
      id:          v.id,
      vendorId:    v.vendorId,
      vendorName,
      username:    v.username,
      profileName: v.profileName,
      amount,
      usedAt:      v.usedAt,
      date:        usedAtObj ? usedAtObj.toISOString().slice(0, 10) : null,
      time:        usedAtObj ? usedAtObj.toISOString().slice(11, 16) : null,
    };
  });

  // Per-vendor summary: count + amount (using max(sqlSum, count×price) approach)
  const summaryMap = new Map<number | null, { vendorId: number | null; vendorName: string; count: number; amount: number }>();
  for (const v of enriched) {
    const key = v.vendorId;
    if (!summaryMap.has(key)) {
      summaryMap.set(key, { vendorId: key, vendorName: v.vendorName, count: 0, amount: 0 });
    }
    const s = summaryMap.get(key)!;
    s.count  += 1;
    s.amount += v.amount;
  }

  // Also add vendors with 0 sales so they appear in the summary
  for (const v of vendors) {
    if (!summaryMap.has(v.id)) {
      summaryMap.set(v.id, { vendorId: v.id, vendorName: v.name, count: 0, amount: 0 });
    }
  }

  const summary = [...summaryMap.values()].sort((a, b) => a.vendorName.localeCompare(b.vendorName, "fr"));

  res.json({ date: dateStr, summary, vouchers: enriched });
});

export default router;
