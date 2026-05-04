import { Router } from "express";
import { eq, desc, and, ne, count, sql, isNotNull, isNull, ilike, inArray, gte, lte, gt } from "drizzle-orm";
import { db, vendorsTable, vouchersTable, routersTable, vendorPaymentsTable, vendorDailyPaymentsTable, profilesCacheTable } from "@workspace/db";
import { hashPassword } from "../lib/vendor-auth.js";
import { verifyAdminTokenFull } from "../lib/admin-auth.js";
import { enableDisableHotspotUsers, type RouterConnection } from "../lib/mikrotik.js";
import { getCachedProfilePricesSync } from "../lib/profile-cache.js";
import { buildProfilePeriodCounts, computeSalesStats } from "../lib/sales-stats.js";
import { logger } from "../lib/logger.js";
import { syncMikrotikUsersToVendor } from "../lib/vendor-sync.js";
import { invalidateVendorPortalCache } from "./vendor-portal.js";

/**
 * Returns the admin scope (adminId + isSuperAdmin) when the request carries
 * a valid admin token, or null when there's no admin token.
 *
 * Several /vendors endpoints serve both admin and vendor-portal callers;
 * routes that strictly require admin should reject when this returns null.
 */
function getAdminScopeOptional(req: import("express").Request): { adminId: number; isSuperAdmin: boolean } | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  return verifyAdminTokenFull(auth.slice(7));
}

const router = Router();

/* ── In-memory TTL cache for admin period-sales (30s) ───────── */
const _apscache = new Map<string, { data: unknown; exp: number }>();
const APSC_TTL = 30_000;
function apscGet(k: string) { const e = _apscache.get(k); return (e && Date.now() < e.exp) ? e.data : null; }
function apscSet(k: string, d: unknown) { _apscache.set(k, { data: d, exp: Date.now() + APSC_TTL }); }

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
  // Tenant scoping: a regular admin token only sees their own vendors.
  // Other auth modes (vendor portal, manager, collab) keep the legacy
  // behavior because they have their own server-side guards.
  const scope = getAdminScopeOptional(req);
  const conds: ReturnType<typeof eq>[] = [];
  if (routerId) conds.push(eq(vendorsTable.routerId, routerId));
  if (scope && !scope.isSuperAdmin) conds.push(eq(vendorsTable.ownerAdminId, scope.adminId));
  const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);
  const vendors = await db.select().from(vendorsTable).where(where).orderBy(vendorsTable.name);
  res.json(vendors.map(safeVendor));
});

router.post("/vendors", async (req, res): Promise<void> => {
  const scope = getAdminScopeOptional(req);
  if (!scope) { res.status(401).json({ error: "Non authentifié" }); return; }
  const { name, phone, email, username, password, routerId, commentSuffix, commentSuffix2, commissionRate, isDemo } = req.body as {
    name?: string;
    phone?: string;
    email?: string;
    username?: string;
    password?: string;
    routerId?: number;
    commentSuffix?: string;
    commentSuffix2?: string;
    commissionRate?: number;
    isDemo?: boolean;
  };

  if (!name || name.trim() === "") {
    res.status(400).json({ error: "Le nom du vendeur est requis" });
    return;
  }

  // Tenant ownership: if a routerId is supplied, make sure it belongs to
  // this admin. Super admin can target any router.
  if (routerId != null && !scope.isSuperAdmin) {
    const [r] = await db.select({ owner: routersTable.ownerAdminId })
      .from(routersTable).where(eq(routersTable.id, routerId));
    if (!r) { res.status(400).json({ error: "Routeur invalide" }); return; }
    if (r.owner == null) {
      res.status(403).json({
        error:
          "Ce routeur n'est pas rattaché à un compte client. Le super administrateur doit le créer depuis la fiche de l'administrateur (Routeurs du client).",
      });
      return;
    }
    if (r.owner !== scope.adminId) {
      res.status(403).json({ error: "Ce routeur ne vous appartient pas" }); return;
    }
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
      ownerAdminId: scope.adminId,
      routerId: routerId ?? null,
      name: name.trim().toUpperCase(),
      phone: phone?.trim() || null,
      email: email?.trim() || null,
      username: resolvedUsername,
      passwordHash,
      commentSuffix: commentSuffix?.trim() || null,
      commentSuffix2: commentSuffix2?.trim() || null,
      commissionRate: Math.min(100, Math.max(0, Math.round(Number(commissionRate) || 0))),
      isDemo: isDemo === true,
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

/* ── PUT /vendors/bulk-commission — must be before /:id to avoid route conflict ── */
router.put("/vendors/bulk-commission", async (req, res): Promise<void> => {
  const { routerId, commissionRate } = req.body as { routerId?: number; commissionRate?: number };
  if (!routerId || isNaN(Number(routerId))) {
    res.status(400).json({ error: "routerId requis" }); return;
  }
  const rate = Math.min(100, Math.max(0, Math.round(Number(commissionRate) || 0)));
  const updated = await db
    .update(vendorsTable)
    .set({ commissionRate: rate })
    .where(eq(vendorsTable.routerId, Number(routerId)))
    .returning({ id: vendorsTable.id });
  res.json({ updated: updated.length, commissionRate: rate });
});

router.put("/vendors/:id", async (req, res): Promise<void> => {
  const scope = getAdminScopeOptional(req);
  if (!scope) { res.status(401).json({ error: "Non authentifié" }); return; }
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const { name, phone, email, username, password, isActive, isDemo, commentSuffix, commentSuffix2, commissionRate } = req.body as {
    name?: string;
    phone?: string;
    email?: string;
    username?: string;
    password?: string;
    isActive?: boolean;
    isDemo?: boolean;
    commentSuffix?: string;
    commentSuffix2?: string;
    commissionRate?: number;
  };

  // Fetch current vendor early (needed for username fallback)
  const [current] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, id));
  if (!current) { res.status(404).json({ error: "Vendeur introuvable" }); return; }
  // Tenant ownership check (regular admins only — super sees all).
  if (!scope.isSuperAdmin && current.ownerAdminId !== scope.adminId) {
    res.status(403).json({ error: "Accès refusé" }); return;
  }

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
  if (isDemo !== undefined) updates.isDemo = isDemo === true;
  if (commentSuffix !== undefined) updates.commentSuffix = commentSuffix?.trim() || null;
  if (commentSuffix2 !== undefined) updates.commentSuffix2 = commentSuffix2?.trim() || null;
  if (commissionRate !== undefined) updates.commissionRate = Math.min(100, Math.max(0, Math.round(Number(commissionRate) || 0)));

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
          .where(and(eq(vouchersTable.vendorId, id), isNull(vouchersTable.usedAt)));

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
  const scope = getAdminScopeOptional(req);
  if (!scope) { res.status(401).json({ error: "Non authentifié" }); return; }
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  // Tenant ownership check (regular admins only — super sees all).
  const [target] = await db.select({ ownerAdminId: vendorsTable.ownerAdminId })
    .from(vendorsTable).where(eq(vendorsTable.id, id));
  if (!target) { res.status(404).json({ error: "Vendeur introuvable" }); return; }
  if (!scope.isSuperAdmin && target.ownerAdminId !== scope.adminId) {
    res.status(403).json({ error: "Accès refusé" }); return;
  }

  const [deleted] = await db
    .delete(vendorsTable)
    .where(eq(vendorsTable.id, id))
    .returning();

  if (!deleted) { res.status(404).json({ error: "Vendeur introuvable" }); return; }
  res.sendStatus(204);
});

/* ─────────────────────────────────────────────────────────────────────
 * GET /vendors/stock-alerts
 * Returns per-vendor, per-profile available-ticket counts,
 * filtered to those below the LOW_STOCK threshold (100).
 * Used by the sidebar notification badge.
 * ──────────────────────────────────────────────────────────────────── */
const LOW_STOCK_THRESHOLD = 100;

router.get("/vendors/stock-alerts", async (req, res): Promise<void> => {
  const routerId = req.query.routerId ? parseInt(req.query.routerId as string, 10) : null;

  // Aggregate available tickets per vendor per profile — also pull routerId so
  // we can cross-check against the profiles cache and exclude ghost profiles.
  const rows = await db
    .select({
      vendorId:        vouchersTable.vendorId,
      profileName:     vouchersTable.profileName,
      vendorRouterId:  vendorsTable.routerId,
      total:           count(),
      used:            sql<number>`count(*) filter (where ${vouchersTable.usedAt} is not null)`,
    })
    .from(vouchersTable)
    .innerJoin(vendorsTable, eq(vouchersTable.vendorId, vendorsTable.id))
    .where(
      and(
        isNotNull(vouchersTable.vendorId),
        isNotNull(vouchersTable.profileName),
        ne(vouchersTable.profileName, ""),
        routerId ? eq(vendorsTable.routerId, routerId) : undefined,
      )
    )
    .groupBy(vouchersTable.vendorId, vouchersTable.profileName, vendorsTable.routerId);

  // Build a profile allowlist from the cache so renamed/deleted profiles are
  // treated as ghost profiles and excluded from alerts.
  // If no cache exists for a router (cache not yet populated), we keep everything
  // for that router as a fail-safe.
  const uniqueRouterIds = [...new Set(rows.map((r) => r.vendorRouterId).filter(Boolean))] as number[];
  const cacheRows = uniqueRouterIds.length
    ? await db
        .select({ routerId: profilesCacheTable.routerId, profileName: profilesCacheTable.profileName })
        .from(profilesCacheTable)
        .where(inArray(profilesCacheTable.routerId, uniqueRouterIds))
    : [];

  // "routerId:profileName" pairs that are confirmed alive in MikroTik
  const validSet = new Set(cacheRows.map((c) => `${c.routerId}:${c.profileName}`));
  // Routers that have at least one cache entry (avoid filtering when cache is empty)
  const routersWithCache = new Set(cacheRows.map((c) => c.routerId));

  // Keep only profiles below threshold that are still alive (not ghost)
  const alerts = rows
    .filter((r) => {
      const available = Number(r.total) - Number(r.used);
      if (Number(r.total) === 0 || available >= LOW_STOCK_THRESHOLD) return false;
      // If the router has cache data, exclude ghost profiles (renamed/deleted)
      if (r.vendorRouterId && routersWithCache.has(r.vendorRouterId)) {
        return validSet.has(`${r.vendorRouterId}:${r.profileName}`);
      }
      return true; // No cache for this router — fail-safe: show all
    })
    .map((r) => ({
      vendorId:    r.vendorId,
      profileName: r.profileName,
      available:   Number(r.total) - Number(r.used),
    }));

  // Enrich with vendor names
  const vendorIds = [...new Set(alerts.map((a) => a.vendorId).filter(Boolean))] as number[];
  const vendorRows = vendorIds.length
    ? await db.select({ id: vendorsTable.id, name: vendorsTable.name })
        .from(vendorsTable)
        .where(inArray(vendorsTable.id, vendorIds))
    : [];
  const vendorNameMap = new Map(vendorRows.map((v) => [v.id, v.name]));

  res.json({
    count: alerts.length,
    alerts: alerts.map((a) => ({
      ...a,
      vendorName: a.vendorId ? (vendorNameMap.get(a.vendorId) ?? "") : "",
    })),
  });
});

router.get("/vendors/reports/summary", async (req, res): Promise<void> => {
  const routerId = req.query.routerId ? parseInt(req.query.routerId as string, 10) : null;
  const vendors = await db
    .select()
    .from(vendorsTable)
    .where(and(
      routerId ? eq(vendorsTable.routerId, routerId) : undefined,
      eq(vendorsTable.isDemo, false),
    ))
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
        buildProfilePeriodCounts(vendor.id, vendor.routerId),
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

  // Déclenche un sync en arrière-plan (non-bloquant) — le sync temps réel (10 s)
  // maintient déjà la DB fraîche ; pas besoin de bloquer la réponse sur MikroTik.
  if (vendor.routerId) {
    const suffixes = [vendor.commentSuffix, vendor.commentSuffix2].filter(Boolean) as string[];
    void syncMikrotikUsersToVendor(vendor.id, vendor.routerId, suffixes);
  }

  // Fetch the vendor's router to get profile prices from MikroTik
  const [router] = vendor.routerId
    ? await db.select().from(routersTable).where(eq(routersTable.id, vendor.routerId))
    : [];

  // Build WHERE conditions for byProfile: always filter by vendorId,
  // additionally by routerId when the vendor has one (avoids stale profiles
  // from previous router assignments), and exclude blank profileNames.
  const byProfileConditions = and(
    eq(vouchersTable.vendorId, id),
    isNotNull(vouchersTable.profileName),
    ne(vouchersTable.profileName, ""),
    ...(vendor.routerId != null ? [eq(vouchersTable.routerId, vendor.routerId)] : []),
  );

  const [totalsRows, byProfileRaw, profilePeriodCounts, recentVouchers, validProfileRows] = await Promise.all([
    buildTotals(id),

    db
      .select({
        profileName: vouchersTable.profileName,
        total: count(),
        printed: sql<number>`count(*) filter (where ${vouchersTable.printedAt} is not null)`,
        used:    sql<number>`count(*) filter (where ${vouchersTable.usedAt} is not null)`,
      })
      .from(vouchersTable)
      .where(byProfileConditions)
      .groupBy(vouchersTable.profileName)
      .orderBy(desc(count())),

    buildProfilePeriodCounts(id, vendor.routerId),

    db
      .select()
      .from(vouchersTable)
      .where(and(eq(vouchersTable.vendorId, id), isNotNull(vouchersTable.usedAt)))
      .orderBy(desc(vouchersTable.usedAt))
      .limit(50),

    // Fetch currently valid profiles from the local cache (reflects live MikroTik state)
    vendor.routerId != null
      ? db.select({ profileName: profilesCacheTable.profileName })
          .from(profilesCacheTable)
          .where(eq(profilesCacheTable.routerId, vendor.routerId))
      : Promise.resolve([] as { profileName: string }[]),
  ]);

  // Build a set of profiles that still exist in MikroTik
  const validProfileNames = new Set(validProfileRows.map((r) => r.profileName));

  // Fetch profile prices from MikroTik cache — authoritative source for amounts
  let priceMap = new Map<string, string>();
  if (router) {
    const conn: RouterConnection = { host: router.host, port: router.port, username: router.username, password: router.password };
    priceMap = getCachedProfilePricesSync(vendor.routerId!, conn);
  }
  // Merge week sales per profile so the frontend gauge can show current-week activity.
  // Filter out profiles that no longer exist in MikroTik (only when cache is populated).
  const weekCountMap = new Map(profilePeriodCounts.map((r) => [r.profileName, Number(r.weekSold)]));
  const byProfile = byProfileRaw
    .filter((row) => validProfileNames.size === 0 || validProfileNames.has(row.profileName))
    .map((row) => ({
    ...row,
    price:    priceMap.get(row.profileName) ?? "",
    weekSold: weekCountMap.get(row.profileName) ?? 0,
  }));

  const totals = totalsRows[0];
  const salesStats = computeSalesStats(profilePeriodCounts, priceMap);

  // Compute totalAvailable from byProfile (filtered by routerId + valid profileName)
  // so this matches what the vendor sees on their Home card.
  const totalAvailable = byProfile.reduce(
    (sum, p) => sum + (Number(p.total) - Number(p.used ?? 0)),
    0,
  );

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
    totalAvailable,
    salesStats,
    byProfile,
    recentVouchers: enrichedRecentVouchers,
  });
});

/* ─────────────────────────────────────────────────────────────────
 * GET /vendors/:id/period-sales?period=today|yesterday|week|month
 * Admin version of the vendor-portal period-sales endpoint.
 * Returns sold vouchers + byProfile breakdown for the given period.
 * ──────────────────────────────────────────────────────────────── */
router.get("/vendors/:id/period-sales", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const { period } = req.query as { period?: string };
  if (!["today", "yesterday", "week", "month"].includes(period ?? "")) {
    res.status(400).json({ error: "Période invalide" }); return;
  }

  const cacheKey = `${id}:${period}`;
  const hit = apscGet(cacheKey);
  if (hit) { res.json(hit); return; }

  const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, id));
  if (!vendor) { res.status(404).json({ error: "Vendeur introuvable" }); return; }

  const periodFilter =
    period === "today"
      ? sql`${vouchersTable.usedAt} >= current_date and ${vouchersTable.usedAt} < current_date + interval '1 day'`
    : period === "yesterday"
      ? sql`${vouchersTable.usedAt} >= current_date - interval '1 day' and ${vouchersTable.usedAt} < current_date`
    : period === "week"
      ? sql`${vouchersTable.usedAt} >= date_trunc('week', current_date - interval '1 week') and ${vouchersTable.usedAt} < date_trunc('week', current_date)`
      : sql`${vouchersTable.usedAt} >= date_trunc('month', current_date) and ${vouchersTable.usedAt} < date_trunc('month', current_date) + interval '1 month'`;

  const labels: Record<string, string> = {
    today: "Aujourd'hui",
    yesterday: "Hier",
    week: "Semaine dernière",
    month: "Mois en cours",
  };

  const [vouchers, byProfileRaw] = await Promise.all([
    db
      .select()
      .from(vouchersTable)
      .where(and(eq(vouchersTable.vendorId, id), periodFilter))
      .orderBy(desc(vouchersTable.usedAt)),
    db
      .select({
        profileName: vouchersTable.profileName,
        count: count(),
        revenue: sql<number>`coalesce(sum(coalesce(nullif(${vouchersTable.salePrice}, '')::numeric, nullif(${vouchersTable.price}, '')::numeric, 0)), 0)`,
      })
      .from(vouchersTable)
      .where(and(eq(vouchersTable.vendorId, id), periodFilter))
      .groupBy(vouchersTable.profileName)
      .orderBy(desc(count())),
  ]);

  let priceMap = new Map<string, string>();
  if (vendor.routerId) {
    const [routerRow] = await db.select().from(routersTable).where(eq(routersTable.id, vendor.routerId));
    if (routerRow) {
      const conn: RouterConnection = { host: routerRow.host, port: routerRow.port, username: routerRow.username, password: routerRow.password };
      priceMap = getCachedProfilePricesSync(vendor.routerId, conn);
    }
  }

  let validProfileNames = new Set<string>();
  if (vendor.routerId) {
    const cached = await db
      .select({ profileName: profilesCacheTable.profileName })
      .from(profilesCacheTable)
      .where(eq(profilesCacheTable.routerId, vendor.routerId));
    validProfileNames = new Set(cached.map((c) => c.profileName));
  }

  const byProfile = byProfileRaw
    .filter((row) => row.profileName && row.profileName.trim() !== "" && (validProfileNames.size === 0 || validProfileNames.has(row.profileName)))
    .map((row) => ({ ...row, price: priceMap.get(row.profileName) ?? "" }));

  const enrichedVouchers = vouchers.map((v) => ({
    ...v,
    price: v.salePrice || v.price || priceMap.get(v.profileName) || "",
  }));

  const revenue = enrichedVouchers.reduce((acc, v) => acc + (parseFloat(v.price ?? "0") || 0), 0);

  const result = {
    vendorName: vendor.name,
    period,
    label: labels[period!],
    total: enrichedVouchers.length,
    revenue,
    byProfile,
    vouchers: enrichedVouchers,
  };
  apscSet(cacheKey, result);
  res.json(result);
});

async function autoSettleHistoricalWeeks(
  routerId: number,
  cutoffWeekStart: string,
  vendors: Array<{ id: number; commissionRate: number | null }>,
) {
  const vendorIds = vendors.map((v) => v.id);
  if (vendorIds.length === 0) return;

  const commissionByVendor = new Map(vendors.map((v) => [v.id, v.commissionRate ?? 0]));

  const salesRaw = await db
    .select({
      vendorId: vouchersTable.vendorId,
      weekStart: sql<string>`date_trunc('week', ${vouchersTable.usedAt})::date::text`,
      amount: sql<number>`coalesce(sum(coalesce(nullif(${vouchersTable.salePrice}, '')::numeric, nullif(${vouchersTable.price}, '')::numeric, 0)), 0)`,
    })
    .from(vouchersTable)
    .where(and(
      eq(vouchersTable.routerId, routerId),
      isNotNull(vouchersTable.usedAt),
      inArray(vouchersTable.vendorId, vendorIds),
      sql`date_trunc('week', ${vouchersTable.usedAt})::date::text < ${cutoffWeekStart}`,
    ))
    .groupBy(vouchersTable.vendorId, sql`date_trunc('week', ${vouchersTable.usedAt})::date::text`);

  const weeklyPaidRaw = await db
    .select({
      vendorId: vendorPaymentsTable.vendorId,
      weekStart: vendorPaymentsTable.weekStart,
      amount: sql<number>`sum(${vendorPaymentsTable.amount})::int`,
    })
    .from(vendorPaymentsTable)
    .where(and(
      eq(vendorPaymentsTable.routerId, routerId),
      inArray(vendorPaymentsTable.vendorId, vendorIds),
      sql`${vendorPaymentsTable.weekStart} < ${cutoffWeekStart}`,
    ))
    .groupBy(vendorPaymentsTable.vendorId, vendorPaymentsTable.weekStart);

  const dailyPaidRaw = await db
    .select({
      vendorId: vendorDailyPaymentsTable.vendorId,
      weekStart: sql<string>`date_trunc('week', ${vendorDailyPaymentsTable.date}::date)::date::text`,
      amount: sql<number>`sum(${vendorDailyPaymentsTable.amount})::int`,
    })
    .from(vendorDailyPaymentsTable)
    .where(and(
      eq(vendorDailyPaymentsTable.routerId, routerId),
      inArray(vendorDailyPaymentsTable.vendorId, vendorIds),
      sql`${vendorDailyPaymentsTable.date} < ${cutoffWeekStart}`,
    ))
    .groupBy(vendorDailyPaymentsTable.vendorId, sql`date_trunc('week', ${vendorDailyPaymentsTable.date}::date)::date::text`);

  const paidByVendorWeek = new Map<string, number>();
  for (const p of weeklyPaidRaw) {
    const key = `${p.vendorId}|${p.weekStart}`;
    paidByVendorWeek.set(key, (paidByVendorWeek.get(key) ?? 0) + p.amount);
  }
  for (const p of dailyPaidRaw) {
    const key = `${p.vendorId}|${p.weekStart}`;
    paidByVendorWeek.set(key, (paidByVendorWeek.get(key) ?? 0) + p.amount);
  }

  // If a regularization week was explicitly removed by user, never auto-recreate it.
  const skipRows = await db
    .select({
      vendorId: vendorPaymentsTable.vendorId,
      weekStart: vendorPaymentsTable.weekStart,
    })
    .from(vendorPaymentsTable)
    .where(and(
      eq(vendorPaymentsTable.routerId, routerId),
      inArray(vendorPaymentsTable.vendorId, vendorIds),
      sql`${vendorPaymentsTable.weekStart} < ${cutoffWeekStart}`,
      ilike(vendorPaymentsTable.note, "Suppression manuelle régularisation auto%"),
    ));
  const skipAutoRegularization = new Set(skipRows.map((r) => `${r.vendorId}|${r.weekStart}`));

  const toInsert: Array<{ vendorId: number; routerId: number; weekStart: string; amount: number; note: string }> = [];
  for (const s of salesRaw) {
    const vendorId = s.vendorId;
    if (!vendorId) continue;
    const weekStart = s.weekStart;
    const weekEnd = new Date(new Date(weekStart + "T00:00:00Z").getTime() + 7 * 86400000);
    const weekEnded = weekEnd.getTime() <= Date.now();
    const commissionRate = weekEnded ? (commissionByVendor.get(vendorId) ?? 0) : 0;
    const commission = commissionRate > 0 ? Math.round(Number(s.amount) * commissionRate) / 100 : 0;
    const expected = Math.max(0, Number(s.amount) - commission);
    const paid = paidByVendorWeek.get(`${vendorId}|${weekStart}`) ?? 0;
    if (skipAutoRegularization.has(`${vendorId}|${weekStart}`)) continue;
    const missing = Math.max(0, Math.round(expected - paid));
    if (missing > 0) {
      toInsert.push({
        vendorId,
        routerId,
        weekStart,
        amount: missing,
        note: `Régularisation auto arriérés (< ${cutoffWeekStart})`,
      });
    }
  }

  if (toInsert.length > 0) {
    await db.insert(vendorPaymentsTable).values(toInsert);
  }
}

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

  // Fetch vendors for this router (all, including demo — needed for voucher enrichment)
  const allVendors = await db
    .select()
    .from(vendorsTable)
    .where(eq(vendorsTable.routerId, routerId))
    .orderBy(vendorsTable.name);
  const demoVendorIds = new Set(allVendors.filter((v) => v.isDemo).map((v) => v.id));
  // Non-demo vendors only for summary reporting
  const vendors = allVendors.filter((v) => !v.isDemo);

  // Lorsqu'on consulte une semaine donnée, solder automatiquement tous les
  // arriérés antérieurs (jours/semaines/mois/années passés) selon la logique
  // de commission, pour ne plus les laisser "non versés".
  const selectedWeekStart = mondayOf(dateStr);
  await autoSettleHistoricalWeeks(
    routerId,
    selectedWeekStart,
    vendors.map((v) => ({ id: v.id, commissionRate: v.commissionRate ?? 0 })),
  );

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

  // Build vendor lookup from ALL vendors (including demo) for correct name resolution
  const vendorMap = new Map(allVendors.map((v) => [v.id, v]));

  // Enrich each voucher — resolve amount via priceMap when salePrice/price missing.
  // Use case-insensitive lookup to handle DB names like "3-Heures" vs MikroTik "3-Heure".
  // Filter out vouchers from demo vendors (they are excluded from reports).
  const enriched = sold.filter((v) => !v.vendorId || !demoVendorIds.has(v.vendorId)).map((v) => {
    const rawAmount = parseFloat(v.salePrice || v.price || "0") || 0;
    const unitPrice = resolveUnitPrice(v.profileName);
    const amount    = rawAmount > 0 ? rawAmount : unitPrice;
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

  // ── Week summary (week of the filtered day) per vendor ────────────────
  const weekStart = mondayOf(dateStr);
  const wStart = new Date(weekStart + "T00:00:00.000Z");
  const wEnd = new Date(wStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  const weekEnd = new Date(wEnd.getTime() - 1).toISOString().slice(0, 10);

  const weekSoldRaw = await db
    .select({
      vendorId:    vouchersTable.vendorId,
      profileName: vouchersTable.profileName,
      count:       sql<number>`count(*)`,
      salePriceSum: sql<number>`coalesce(sum(nullif(${vouchersTable.salePrice},'')::numeric), 0)`,
      priceSum:     sql<number>`coalesce(sum(nullif(${vouchersTable.price},'')::numeric), 0)`,
    })
    .from(vouchersTable)
    .where(
      and(
        eq(vouchersTable.routerId, routerId),
        isNotNull(vouchersTable.usedAt),
        sql`${vouchersTable.usedAt} >= ${wStart.toISOString()}`,
        sql`${vouchersTable.usedAt} <  ${wEnd.toISOString()}`,
      ),
    )
    .groupBy(vouchersTable.vendorId, vouchersTable.profileName);

  // Weekly lump-sum payments (vendorPaymentsTable) + daily payments (vendorDailyPaymentsTable)
  // for the same week — both contribute to paidByVendor so the report stays accurate.
  const [weekPayments, weekDailyPayments] = await Promise.all([
    db.select().from(vendorPaymentsTable).where(
      and(
        eq(vendorPaymentsTable.routerId, routerId),
        eq(vendorPaymentsTable.weekStart, weekStart),
      ),
    ),
    db.select().from(vendorDailyPaymentsTable).where(
      and(
        eq(vendorDailyPaymentsTable.routerId, routerId),
        gte(vendorDailyPaymentsTable.date, weekStart),
        lte(vendorDailyPaymentsTable.date, weekEnd),
      ),
    ),
  ]);

  // Aggregate week rows per vendor — same max(sqlSum, count×price) approach
  const weekMap = new Map<number | null, { vendorId: number | null; vendorName: string; count: number; amount: number; commissionRate: number }>();
  for (const v of vendors) {
    weekMap.set(v.id, { vendorId: v.id, vendorName: v.name, count: 0, amount: 0, commissionRate: v.commissionRate ?? 0 });
  }
  for (const row of weekSoldRaw) {
    const key  = row.vendorId;
    // Skip demo vendors — they are excluded from reports
    if (key && demoVendorIds.has(key)) continue;
    const cnt  = Number(row.count);
    const raw  = Math.max(Number(row.salePriceSum), Number(row.priceSum));
    const unit = resolveUnitPrice(row.profileName);
    const amt  = raw > 0 ? raw : cnt * unit;
    if (!weekMap.has(key)) {
      const vname = key ? (vendorMap.get(key)?.name ?? "Inconnu") : "Sans vendeur";
      weekMap.set(key, { vendorId: key, vendorName: vname, count: 0, amount: 0, commissionRate: 0 });
    }
    const w = weekMap.get(key)!;
    w.count  += cnt;
    w.amount += amt;
  }
  // Track weekly lump-sum vs daily payments separately so the frontend can
  // show "weekly expected after daily deductions".
  const weeklyPaidByVendor = new Map<number, number>();
  const dailyPaidByVendor  = new Map<number, number>();
  for (const p of weekPayments) {
    weeklyPaidByVendor.set(p.vendorId, (weeklyPaidByVendor.get(p.vendorId) ?? 0) + p.amount);
  }
  for (const p of weekDailyPayments) {
    dailyPaidByVendor.set(p.vendorId, (dailyPaidByVendor.get(p.vendorId) ?? 0) + p.amount);
  }

  // Carry-over from all prior weeks (before current weekStart):
  // for each prior week: max(0, expected_net - paid_week), summed per vendor.
  const vendorIds = vendors.map((v) => v.id);
  const [historicalSalesRaw, historicalWeeklyPaidRaw, historicalDailyPaidRaw] = await Promise.all([
    db.select({
      vendorId: vouchersTable.vendorId,
      weekStart: sql<string>`date_trunc('week', ${vouchersTable.usedAt})::date::text`,
      amount: sql<number>`coalesce(sum(coalesce(nullif(${vouchersTable.salePrice}, '')::numeric, nullif(${vouchersTable.price}, '')::numeric, 0)), 0)`,
    })
      .from(vouchersTable)
      .where(and(
        eq(vouchersTable.routerId, routerId),
        isNotNull(vouchersTable.usedAt),
        inArray(vouchersTable.vendorId, vendorIds),
        sql`date_trunc('week', ${vouchersTable.usedAt})::date::text < ${weekStart}`,
      ))
      .groupBy(vouchersTable.vendorId, sql`date_trunc('week', ${vouchersTable.usedAt})::date::text`),
    db.select({
      vendorId: vendorPaymentsTable.vendorId,
      weekStart: vendorPaymentsTable.weekStart,
      amount: sql<number>`sum(${vendorPaymentsTable.amount})::int`,
    })
      .from(vendorPaymentsTable)
      .where(and(
        eq(vendorPaymentsTable.routerId, routerId),
        inArray(vendorPaymentsTable.vendorId, vendorIds),
        sql`${vendorPaymentsTable.weekStart} < ${weekStart}`,
        gt(vendorPaymentsTable.amount, 0),
      ))
      .groupBy(vendorPaymentsTable.vendorId, vendorPaymentsTable.weekStart),
    db.select({
      vendorId: vendorDailyPaymentsTable.vendorId,
      weekStart: sql<string>`date_trunc('week', ${vendorDailyPaymentsTable.date}::date)::date::text`,
      amount: sql<number>`sum(${vendorDailyPaymentsTable.amount})::int`,
    })
      .from(vendorDailyPaymentsTable)
      .where(and(
        eq(vendorDailyPaymentsTable.routerId, routerId),
        inArray(vendorDailyPaymentsTable.vendorId, vendorIds),
        sql`${vendorDailyPaymentsTable.date} < ${weekStart}`,
      ))
      .groupBy(vendorDailyPaymentsTable.vendorId, sql`date_trunc('week', ${vendorDailyPaymentsTable.date}::date)::date::text`),
  ]);

  const historicalPaidByVendorWeek = new Map<string, number>();
  for (const p of historicalWeeklyPaidRaw) {
    const k = `${p.vendorId}|${p.weekStart}`;
    historicalPaidByVendorWeek.set(k, (historicalPaidByVendorWeek.get(k) ?? 0) + Number(p.amount || 0));
  }
  for (const p of historicalDailyPaidRaw) {
    const k = `${p.vendorId}|${p.weekStart}`;
    historicalPaidByVendorWeek.set(k, (historicalPaidByVendorWeek.get(k) ?? 0) + Number(p.amount || 0));
  }

  const carryOverByVendor = new Map<number, number>();
  const carryOverWeekCountByVendor = new Map<number, number>();
  for (const s of historicalSalesRaw) {
    if (!s.vendorId || demoVendorIds.has(s.vendorId)) continue;
    const commRate = vendorMap.get(s.vendorId)?.commissionRate ?? 0;
    const expected = Math.max(0, Number(s.amount || 0) - Math.round(Number(s.amount || 0) * commRate) / 100);
    const paid = historicalPaidByVendorWeek.get(`${s.vendorId}|${s.weekStart}`) ?? 0;
    const missing = Math.max(0, Math.round(expected - paid));
    if (missing > 0) {
      carryOverByVendor.set(s.vendorId, (carryOverByVendor.get(s.vendorId) ?? 0) + missing);
      carryOverWeekCountByVendor.set(s.vendorId, (carryOverWeekCountByVendor.get(s.vendorId) ?? 0) + 1);
    }
  }

  // Commission only applies once the week is fully over
  const weekEndedForSummary = new Date(weekEnd + "T23:59:59.999Z") < new Date();

  const weekSummary = [...weekMap.values()]
    .map((w) => {
      const vendorCarryOver = !w.vendorId ? 0 : (carryOverByVendor.get(w.vendorId) ?? 0);
      const vendorCarryOverWeekCount = !w.vendorId ? 0 : (carryOverWeekCountByVendor.get(w.vendorId) ?? 0);
      const weeklyPaid = w.vendorId ? (weeklyPaidByVendor.get(w.vendorId) ?? 0) : 0;
      const dailyPaid  = w.vendorId ? (dailyPaidByVendor.get(w.vendorId) ?? 0) : 0;
      const paidAmount = weeklyPaid + dailyPaid;
      const commission = (weekEndedForSummary && w.commissionRate > 0)
        ? Math.round(w.amount * w.commissionRate) / 100
        : 0;
      // What the vendor owes total = sales - commission
      const expected   = Math.max(0, w.amount - commission);
      // What still must be paid via WEEKLY mechanism (after deducting daily payments)
      const weeklyExpected  = Math.max(0, expected - dailyPaid);
      const remainingAmount = Math.max(0, expected - paidAmount);
      const totalExpectedToPay = expected + vendorCarryOver;
      const totalToPay = Math.max(0, totalExpectedToPay - paidAmount);
      const paymentStatus =
        totalExpectedToPay <= 0
          ? "none"
          : paidAmount >= totalExpectedToPay
            ? "full"
            : paidAmount > 0
              ? "partial"
              : "none";
      return {
        ...w,
        weeklyPaid,
        dailyPaid,
        paidAmount,
        commission,
        weeklyExpected,
        remainingAmount,
        carryOverAmount: vendorCarryOver,
        carryOverWeekCount: vendorCarryOverWeekCount,
        totalToPay,
        paymentStatus,
      };
    })
    .filter((w) => w.count > 0 || w.paidAmount > 0)
    .sort((a, b) => a.vendorName.localeCompare(b.vendorName, "fr"));

  res.json({ date: dateStr, summary, vouchers: enriched, weekSummary, weekStart, weekEnd });
});

/* ─────────────────────────────────────────────────────────────────────────
 *  VERSEMENTS JOURNALIERS — daily vendor payments
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * GET /vendors/daily-payments?routerId=X&date=YYYY-MM-DD
 *   Returns payments for a single day (legacy, no vendor name).
 * GET /vendors/daily-payments?routerId=X&from=YYYY-MM-DD&to=YYYY-MM-DD
 *   Returns payments for a date range, including vendorName joined from vendors table.
 */
router.get("/vendors/daily-payments", async (req, res): Promise<void> => {
  const routerId = req.query.routerId ? parseInt(req.query.routerId as string, 10) : null;
  if (!routerId || isNaN(routerId)) { res.status(400).json({ error: "routerId requis" }); return; }

  const from = (req.query.from as string) ?? "";
  const to   = (req.query.to   as string) ?? "";

  if (from && to) {
    // Range query — includes vendor name
    const rows = await db
      .select({
        id:         vendorDailyPaymentsTable.id,
        vendorId:   vendorDailyPaymentsTable.vendorId,
        vendorName: vendorsTable.name,
        routerId:   vendorDailyPaymentsTable.routerId,
        date:       vendorDailyPaymentsTable.date,
        amount:     vendorDailyPaymentsTable.amount,
        note:       vendorDailyPaymentsTable.note,
        paidAt:     vendorDailyPaymentsTable.paidAt,
      })
      .from(vendorDailyPaymentsTable)
      .innerJoin(vendorsTable, eq(vendorDailyPaymentsTable.vendorId, vendorsTable.id))
      .where(and(
        eq(vendorDailyPaymentsTable.routerId, routerId),
        gte(vendorDailyPaymentsTable.date, from),
        lte(vendorDailyPaymentsTable.date, to),
      ))
      .orderBy(vendorDailyPaymentsTable.date, vendorDailyPaymentsTable.paidAt);
    res.json(rows);
    return;
  }

  // Single day (legacy)
  const date = (req.query.date as string) ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { res.status(400).json({ error: "date ou from/to YYYY-MM-DD requis" }); return; }
  const rows = await db
    .select()
    .from(vendorDailyPaymentsTable)
    .where(and(eq(vendorDailyPaymentsTable.routerId, routerId), eq(vendorDailyPaymentsTable.date, date)))
    .orderBy(vendorDailyPaymentsTable.paidAt);
  res.json(rows);
});

/**
 * POST /vendors/:id/daily-payments
 * Body: { routerId, date, amount, note? }
 * Records a daily payment for the vendor.
 */
router.post("/vendors/:id/daily-payments", async (req, res): Promise<void> => {
  const vendorId = parseInt(req.params.id, 10);
  if (isNaN(vendorId)) { res.status(400).json({ error: "vendorId invalide" }); return; }
  const { routerId, date, amount, note } = req.body as { routerId: number; date: string; amount: number; note?: string };
  if (!routerId || !date || !amount || amount <= 0) { res.status(400).json({ error: "routerId, date et amount requis" }); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { res.status(400).json({ error: "date YYYY-MM-DD invalide" }); return; }
  const weekStart = mondayOf(date);
  const wStart = new Date(weekStart + "T00:00:00Z");
  const wEnd = new Date(wStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  const weekEnded = wEnd.getTime() <= Date.now();

  const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, vendorId));
  if (!vendor) { res.status(404).json({ error: "Vendeur introuvable" }); return; }

  const [salesRow] = await db
    .select({
      amount: sql<number>`coalesce(sum(coalesce(nullif(${vouchersTable.salePrice}, '')::numeric, nullif(${vouchersTable.price}, '')::numeric, 0)), 0)`,
    })
    .from(vouchersTable)
    .where(and(
      eq(vouchersTable.routerId, routerId),
      eq(vouchersTable.vendorId, vendorId),
      isNotNull(vouchersTable.usedAt),
      sql`${vouchersTable.usedAt} >= ${wStart.toISOString()}`,
      sql`${vouchersTable.usedAt} < ${wEnd.toISOString()}`,
    ));

  const [weeklyPaidRow] = await db
    .select({ amount: sql<number>`coalesce(sum(${vendorPaymentsTable.amount}), 0)::int` })
    .from(vendorPaymentsTable)
    .where(and(
      eq(vendorPaymentsTable.routerId, routerId),
      eq(vendorPaymentsTable.vendorId, vendorId),
      eq(vendorPaymentsTable.weekStart, weekStart),
    ));

  const [dailyPaidRow] = await db
    .select({ amount: sql<number>`coalesce(sum(${vendorDailyPaymentsTable.amount}), 0)::int` })
    .from(vendorDailyPaymentsTable)
    .where(and(
      eq(vendorDailyPaymentsTable.routerId, routerId),
      eq(vendorDailyPaymentsTable.vendorId, vendorId),
      gte(vendorDailyPaymentsTable.date, weekStart),
      lte(vendorDailyPaymentsTable.date, new Date(wEnd.getTime() - 1).toISOString().slice(0, 10)),
    ));

  const salesAmount = Number(salesRow?.amount ?? 0);
  const commission = weekEnded && (vendor.commissionRate ?? 0) > 0
    ? Math.round(salesAmount * (vendor.commissionRate ?? 0)) / 100
    : 0;
  const expectedNet = Math.max(0, salesAmount - commission);
  const alreadyPaid = Number(weeklyPaidRow?.amount ?? 0) + Number(dailyPaidRow?.amount ?? 0);
  const remaining = Math.max(0, Math.round(expectedNet - alreadyPaid));
  if (remaining <= 0) {
    res.status(400).json({ error: "Semaine déjà soldée (commission déduite)" });
    return;
  }

  const requested = Math.round(amount);
  const appliedAmount = Math.min(requested, remaining);
  const [row] = await db
    .insert(vendorDailyPaymentsTable)
    .values({ vendorId, routerId, date, amount: appliedAmount, note: note ?? null })
    .returning();
  invalidateVendorPortalCache(vendorId);
  res.json({
    ...row,
    requestedAmount: requested,
    appliedAmount,
    adjusted: appliedAmount !== requested,
    weekStart,
    expectedNet,
    remainingAfter: Math.max(0, remaining - appliedAmount),
  });
});

/**
 * DELETE /vendors/daily-payments/:id
 * Removes a specific daily payment entry.
 */
router.delete("/vendors/daily-payments/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "id invalide" }); return; }
  const [deleted] = await db
    .delete(vendorDailyPaymentsTable)
    .where(eq(vendorDailyPaymentsTable.id, id))
    .returning({ vendorId: vendorDailyPaymentsTable.vendorId });
  if (!deleted) { res.status(404).json({ error: "Versement déjà supprimé ou inexistant" }); return; }
  invalidateVendorPortalCache(deleted.vendorId);
  res.json({ ok: true });
});

/* ─────────────────────────────────────────────────────────────────────────
 * GET /vendors/daily-arrears?routerId=X&date=YYYY-MM-DD
 * Returns per-vendor arriérés: past days (< date) with unpaid sales
 * based on weekly payment status for finished weeks.
 * ──────────────────────────────────────────────────────────────────────── */
router.get("/vendors/daily-arrears", async (req, res): Promise<void> => {
  const routerId = req.query.routerId ? parseInt(req.query.routerId as string, 10) : null;
  if (!routerId || isNaN(routerId)) { res.status(400).json({ error: "routerId requis" }); return; }

  let dateStr = (req.query.date as string) ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) dateStr = new Date().toISOString().slice(0, 10);

  // 30-day window ending the day before the selected date
  const selectedDay = new Date(dateStr + "T00:00:00.000Z");
  const windowEnd   = new Date(selectedDay.getTime() - 24 * 60 * 60 * 1000);
  const windowStart = new Date(selectedDay.getTime() - 31 * 24 * 60 * 60 * 1000);
  const wStartStr   = windowStart.toISOString().slice(0, 10);
  const wEndStr     = windowEnd.toISOString().slice(0, 10);
  if (wStartStr >= wEndStr) { res.json({ arrears: {} }); return; }

  const [routerRow] = await db.select().from(routersTable).where(eq(routersTable.id, routerId));
  if (!routerRow) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  const conn: RouterConnection = { host: routerRow.host, port: routerRow.port, username: routerRow.username, password: routerRow.password };
  const priceMap = getCachedProfilePricesSync(routerId, conn);
  const priceMapLower = new Map([...priceMap.entries()].map(([k, v]) => [k.toLowerCase(), v]));
  function resolveUnit(profileName: string): number {
    const raw = priceMap.get(profileName) ?? priceMapLower.get(profileName.toLowerCase()) ?? "0";
    return parseFloat(raw.replace(/[^0-9.]/g, "")) || 0;
  }

  const allVendors = await db.select().from(vendorsTable).where(eq(vendorsTable.routerId, routerId));
  const demoIds = new Set(allVendors.filter((v) => v.isDemo).map((v) => v.id));
  const vendors  = allVendors.filter((v) => !v.isDemo);
  const vendorCommMap = new Map(vendors.map((v) => [v.id, v.commissionRate ?? 0]));

  // Per-vendor, per-date, per-profile aggregation
  const soldRaw = await db
    .select({
      vendorId:     vouchersTable.vendorId,
      profileName:  vouchersTable.profileName,
      date:         sql<string>`(${vouchersTable.usedAt})::date::text`,
      cnt:          sql<number>`count(*)`,
      salePriceSum: sql<number>`coalesce(sum(nullif(${vouchersTable.salePrice},'')::numeric), 0)`,
      priceSum:     sql<number>`coalesce(sum(nullif(${vouchersTable.price},'')::numeric), 0)`,
    })
    .from(vouchersTable)
    .where(
      and(
        eq(vouchersTable.routerId, routerId),
        isNotNull(vouchersTable.usedAt),
        sql`(${vouchersTable.usedAt})::date >= ${wStartStr}::date`,
        sql`(${vouchersTable.usedAt})::date <= ${wEndStr}::date`,
      )
    )
    .groupBy(vouchersTable.vendorId, vouchersTable.profileName, sql`(${vouchersTable.usedAt})::date`);

  // Aggregate: vendorId → date → salesAmount
  const vendorDayMap = new Map<number, Map<string, number>>();

  for (const row of soldRaw) {
    if (!row.vendorId || demoIds.has(row.vendorId)) continue;
    const cnt  = Number(row.cnt);
    const raw  = Math.max(Number(row.salePriceSum), Number(row.priceSum));
    const unit = resolveUnit(row.profileName);
    // Use stored price as authoritative; only fall back to live router profile price when no stored price
    const amt  = raw > 0 ? raw : cnt * unit;

    if (!vendorDayMap.has(row.vendorId)) vendorDayMap.set(row.vendorId, new Map());
    const dm = vendorDayMap.get(row.vendorId)!;
    dm.set(row.date, (dm.get(row.date) ?? 0) + amt);
  }

  // Fetch per-day payments from vendor_daily_payments for the same date window
  const dailyPayments = await db
    .select()
    .from(vendorDailyPaymentsTable)
    .where(
      and(
        eq(vendorDailyPaymentsTable.routerId, routerId),
        sql`${vendorDailyPaymentsTable.date} >= ${wStartStr}`,
        sql`${vendorDailyPaymentsTable.date} <= ${wEndStr}`,
      )
    );

  // Map: "vendorId|date" → { paidAmount, payments[] }
  const dailyPaidMap = new Map<string, { paidAmount: number; payments: { id: number; amount: number }[] }>();
  for (const p of dailyPayments) {
    const k = `${p.vendorId}|${p.date}`;
    if (!dailyPaidMap.has(k)) dailyPaidMap.set(k, { paidAmount: 0, payments: [] });
    const entry = dailyPaidMap.get(k)!;
    entry.paidAmount += p.amount;
    entry.payments.push({ id: p.id, amount: p.amount });
  }

  // Helper: Monday of a given YYYY-MM-DD string (UTC)
  function getMondayOf(dateStr: string): string {
    const d = new Date(dateStr + "T00:00:00Z");
    const dow = d.getUTCDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    return new Date(d.getTime() + diff * 86_400_000).toISOString().slice(0, 10);
  }

  // Fetch weekly LUMP-SUM payments (vendorPaymentsTable) for the same window.
  // Une semaine peut être soldée via un versement hebdomadaire et non
  // forcément via des versements journaliers. Sans ça, le seuil "semaine
  // soldée" ne se déclenche jamais et les anciens jours restent visibles.
  const wStartMonday = getMondayOf(wStartStr);
  const weeklyLumpRows = await db
    .select()
    .from(vendorPaymentsTable)
    .where(
      and(
        eq(vendorPaymentsTable.routerId, routerId),
        sql`${vendorPaymentsTable.weekStart} >= ${wStartMonday}`,
        sql`${vendorPaymentsTable.weekStart} <= ${wEndStr}`,
      )
    );

  // Map: "vendorId|weekStart(Monday)" → total lump-sum paid for that week
  const weeklyLumpMap = new Map<string, number>();
  for (const p of weeklyLumpRows) {
    const k = `${p.vendorId}|${p.weekStart}`;
    weeklyLumpMap.set(k, (weeklyLumpMap.get(k) ?? 0) + p.amount);
  }

  // Build arrears: per-day, with weekly cutoff (same logic as vendor portal).
  // Semaine soldée (masquée) ⇒ aucun arriéré journalier pour cette semaine ni pour les semaines ≤ dernière semaine soldée.
  const arrears: Record<string, { date: string; salesAmount: number; paidAmount: number; remaining: number; payments: { id: number; amount: number }[] }[]> = {};
  const settledWeeks: Record<string, string[]> = {};

  for (const [vendorId, dayMap] of vendorDayMap) {
    // Build per-date paid amounts for this vendor
    const salesMapV = new Map<string, number>(dayMap);
    const paidMapV  = new Map<string, number>();
    for (const [date] of dayMap) {
      const k = `${vendorId}|${date}`;
      const p = dailyPaidMap.get(k);
      if (p) paidMapV.set(date, p.paidAmount);
    }
    // Also include payment days not in salesMap (lump-sum payments on no-sale days)
    for (const [k, p] of dailyPaidMap) {
      const [vId, date] = k.split("|");
      if (Number(vId) === vendorId && !paidMapV.has(date)) {
        paidMapV.set(date, p.paidAmount);
      }
    }

    // Collect all unique week-Mondays from sales + payments
    const weekMondaysSet = new Set<string>();
    for (const [date] of salesMapV) weekMondaysSet.add(getMondayOf(date));
    for (const [date] of paidMapV) weekMondaysSet.add(getMondayOf(date));
    // Include weeks that have lump-sum payments so FIFO can allocate them
    for (const k of weeklyLumpMap.keys()) {
      const [vId, monday] = k.split("|");
      if (Number(vId) === vendorId) weekMondaysSet.add(monday);
    }
    const weekMondaysFinal = [...weekMondaysSet].sort().reverse();

    // Apply commission to each day proportionally once the week is ended, so
    // daily settlements and arrears use the same "net attendu" as weekly logic.
    const expectedByDay = new Map<string, number>();
    const expectedByWeek = new Map<string, number>();
    for (const monday of weekMondaysFinal) {
      const ws = new Date(monday + "T00:00:00Z");
      const we = new Date(ws.getTime() + 7 * 86_400_000);
      const weekEnded = we.getTime() <= Date.now();
      const rate = weekEnded ? (vendorCommMap.get(vendorId) ?? 0) : 0;
      const weekDates = Array.from({ length: 7 }, (_, i) =>
        new Date(ws.getTime() + i * 86_400_000).toISOString().slice(0, 10),
      );
      const weekGross = weekDates.reduce((s, d) => s + (salesMapV.get(d) ?? 0), 0);
      const weekCommission = rate > 0 ? Math.round(weekGross * rate) / 100 : 0;
      const weekExpected = Math.max(0, weekGross - weekCommission);
      expectedByWeek.set(monday, weekExpected);
      const factor = weekGross > 0 ? (weekExpected / weekGross) : 1;
      for (const d of weekDates) {
        const gross = salesMapV.get(d) ?? 0;
        expectedByDay.set(d, Math.max(0, Math.round(gross * factor)));
      }
    }

    // Allouer les versements hebdomadaires (lump-sum) jour par jour en FIFO :
    // chaque versement hebdo solde d'abord les jours les plus anciens de SA
    // semaine. Sans ça, un versement hebdo partiel laisse les arriérés
    // journaliers afficher la dette pleine au lieu du reliquat réel.
    const lumpAllocatedPaid = new Map<string, number>(); // date → portion lump-sum allouée
    for (const monday of weekMondaysFinal) {
      let lumpRemaining = weeklyLumpMap.get(`${vendorId}|${monday}`) ?? 0;
      if (lumpRemaining <= 0) continue;
      const weekStart = new Date(monday + "T00:00:00Z");
      for (let i = 0; i < 7 && lumpRemaining > 0; i++) {
        const d = new Date(weekStart.getTime() + i * 86_400_000).toISOString().slice(0, 10);
        const sales      = expectedByDay.get(d) ?? (salesMapV.get(d) ?? 0);
        const dailyPaid  = paidMapV.get(d)  ?? 0;
        const stillOwed  = Math.max(0, sales - dailyPaid);
        if (stillOwed === 0) continue;
        const allocate = Math.min(lumpRemaining, stillOwed);
        lumpAllocatedPaid.set(d, (lumpAllocatedPaid.get(d) ?? 0) + allocate);
        lumpRemaining -= allocate;
      }
    }

    // Hard guard: once a week is globally settled (daily + weekly paid >= expected net),
    // hide every day in that week from daily arrears to avoid false residuals due to
    // per-day rounding/allocation artifacts.
    const settledWeekMap = new Map<string, boolean>();
    for (const monday of weekMondaysFinal) {
      const ws = new Date(monday + "T00:00:00Z");
      const weekDates = Array.from({ length: 7 }, (_, i) =>
        new Date(ws.getTime() + i * 86_400_000).toISOString().slice(0, 10),
      );
      const expectedWeek = expectedByWeek.get(monday) ?? 0;
      const dailyPaidWeek = weekDates.reduce((s, d) => s + (paidMapV.get(d) ?? 0), 0);
      const weeklyLump = weeklyLumpMap.get(`${vendorId}|${monday}`) ?? 0;
      const paidWeek = dailyPaidWeek + weeklyLump;
      settledWeekMap.set(monday, paidWeek >= Math.max(0, expectedWeek - 1));
    }

    let vendorArr: typeof arrears[string] = [];
    for (const [date, grossSalesAmount] of dayMap) {
      const monday = getMondayOf(date);
      if (settledWeekMap.get(monday)) {
        continue;
      }
      const k = `${vendorId}|${date}`;
      const { paidAmount: dailyPaidRaw, payments } = dailyPaidMap.get(k) ?? { paidAmount: 0, payments: [] };
      const lumpAllocated = lumpAllocatedPaid.get(date) ?? 0;
      const paidAmount = dailyPaidRaw + lumpAllocated;
      const salesAmount = expectedByDay.get(date) ?? grossSalesAmount;
      const remaining  = Math.max(0, salesAmount - paidAmount);
      if (remaining > 0) {
        vendorArr.push({ date, salesAmount, paidAmount, remaining, payments });
      }
    }

    // Semaines masquées (soldées) : aucun arriéré journalier pour ces semaines ni pour les semaines ≤ dernière semaine soldée.
    let latestSettledMonday: string | null = null;
    for (const [m, ok] of settledWeekMap) {
      if (ok && (!latestSettledMonday || m > latestSettledMonday)) latestSettledMonday = m;
    }
    vendorArr = vendorArr.filter((e) => {
      const m = getMondayOf(e.date);
      if (settledWeekMap.get(m)) return false;
      if (latestSettledMonday && m <= latestSettledMonday) return false;
      return true;
    });

    // Sort oldest first
    vendorArr.sort((a, b) => a.date.localeCompare(b.date));
    if (vendorArr.length > 0) arrears[String(vendorId)] = vendorArr;
    const maskedWeekMondays = [...settledWeekMap.entries()].filter(([, ok]) => ok).map(([m]) => m).sort();
    if (maskedWeekMondays.length > 0) settledWeeks[String(vendorId)] = maskedWeekMondays;
  }

  const vendorInfoMap: Record<string, { name: string }> = {};
  for (const v of vendors) vendorInfoMap[String(v.id)] = { name: v.name };

  res.json({ arrears, vendorInfo: vendorInfoMap, settledWeeks });
});

/* ─────────────────────────────────────────────────────────────────────────
 *  VERSEMENTS (vendor payments)
 * ──────────────────────────────────────────────────────────────────────── */

/** Return YYYY-MM-DD of the Monday for any given date string (YYYY-MM-DD) */
function mondayOf(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  const day = d.getUTCDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

async function autoSettleDailyRowsForValidatedWeek(
  routerId: number,
  vendorId: number,
  weekStart: string,
  commissionRate: number,
) {
  const wStart = new Date(weekStart + "T00:00:00Z");
  const wEnd = new Date(wStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  const weekEnded = wEnd.getTime() <= Date.now();
  const weekEndStr = new Date(wEnd.getTime() - 1).toISOString().slice(0, 10);

  const salesRows = await db
    .select({
      date: sql<string>`(${vouchersTable.usedAt})::date::text`,
      amount: sql<number>`coalesce(sum(coalesce(nullif(${vouchersTable.salePrice}, '')::numeric, nullif(${vouchersTable.price}, '')::numeric, 0)), 0)`,
    })
    .from(vouchersTable)
    .where(and(
      eq(vouchersTable.routerId, routerId),
      eq(vouchersTable.vendorId, vendorId),
      isNotNull(vouchersTable.usedAt),
      sql`${vouchersTable.usedAt} >= ${wStart.toISOString()}`,
      sql`${vouchersTable.usedAt} < ${wEnd.toISOString()}`,
    ))
    .groupBy(sql`(${vouchersTable.usedAt})::date`);

  const dailyPaidRows = await db
    .select({
      date: vendorDailyPaymentsTable.date,
      amount: sql<number>`sum(${vendorDailyPaymentsTable.amount})::int`,
    })
    .from(vendorDailyPaymentsTable)
    .where(and(
      eq(vendorDailyPaymentsTable.routerId, routerId),
      eq(vendorDailyPaymentsTable.vendorId, vendorId),
      gte(vendorDailyPaymentsTable.date, weekStart),
      lte(vendorDailyPaymentsTable.date, weekEndStr),
    ))
    .groupBy(vendorDailyPaymentsTable.date);

  const dailyPaidMap = new Map(dailyPaidRows.map((r) => [r.date, Number(r.amount) || 0]));
  const weekSales = salesRows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const weekCommission = weekEnded && commissionRate > 0 ? Math.round(weekSales * commissionRate) / 100 : 0;
  const weekExpected = Math.max(0, weekSales - weekCommission);
  const factor = weekSales > 0 ? (weekExpected / weekSales) : 1;

  const toInsert: Array<{ vendorId: number; routerId: number; date: string; amount: number; note: string }> = [];
  for (const r of salesRows) {
    const gross = Number(r.amount) || 0;
    const expectedDay = Math.max(0, Math.round(gross * factor));
    const paidDay = dailyPaidMap.get(r.date) ?? 0;
    const missing = Math.max(0, expectedDay - paidDay);
    if (missing > 0) {
      toInsert.push({
        vendorId,
        routerId,
        date: r.date,
        amount: missing,
        note: `Soldé auto via validation semaine ${weekStart}`,
      });
    }
  }
  if (toInsert.length > 0) await db.insert(vendorDailyPaymentsTable).values(toInsert);
}

/**
 * GET /api/vendors/weekly-summary
 * Query: routerId, weekStart (YYYY-MM-DD, any day of the week — forced to Monday)
 * Returns per-vendor: sales for the week + payments + remaining
 */
router.get("/vendors/weekly-summary", async (req, res): Promise<void> => {
  try {
    const routerId = parseInt(req.query.routerId as string);
    if (isNaN(routerId)) { res.status(400).json({ error: "routerId required" }); return; }

    const rawWeek = (req.query.weekStart as string) ?? new Date().toISOString().slice(0, 10);
    const weekStart = mondayOf(rawWeek);
    const wStart = new Date(weekStart + "T00:00:00Z");
    const wEnd   = new Date(wStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    const vendors = await db
      .select()
      .from(vendorsTable)
      .where(and(eq(vendorsTable.routerId, routerId), eq(vendorsTable.isActive, true), eq(vendorsTable.isDemo, false)));

    const salesRaw = await db
      .select({
        vendorId:     vouchersTable.vendorId,
        profileName:  vouchersTable.profileName,
        cnt:          sql<number>`count(*)`,
        salePriceSum: sql<number>`coalesce(sum(nullif(${vouchersTable.salePrice},'')::numeric), 0)`,
        priceSum:     sql<number>`coalesce(sum(nullif(${vouchersTable.price},'')::numeric), 0)`,
      })
      .from(vouchersTable)
      .where(
        and(
          eq(vouchersTable.routerId, routerId),
          isNotNull(vouchersTable.usedAt),
          sql`${vouchersTable.usedAt} >= ${wStart.toISOString()}`,
          sql`${vouchersTable.usedAt} <  ${wEnd.toISOString()}`,
        ),
      )
      .groupBy(vouchersTable.vendorId, vouchersTable.profileName);

    const weekEnd = new Date(wEnd.getTime() - 1).toISOString().slice(0, 10);

    // Both weekly lump-sum payments and daily payments count toward paidAmount
    const [payments, dailyPayments] = await Promise.all([
      db.select().from(vendorPaymentsTable).where(
        and(
          eq(vendorPaymentsTable.routerId, routerId),
          eq(vendorPaymentsTable.weekStart, weekStart),
          gt(vendorPaymentsTable.amount, 0),
        ),
      ).orderBy(vendorPaymentsTable.paidAt),
      db.select().from(vendorDailyPaymentsTable).where(
        and(
          eq(vendorDailyPaymentsTable.routerId, routerId),
          gte(vendorDailyPaymentsTable.date, weekStart),
          lte(vendorDailyPaymentsTable.date, weekEnd),
        ),
      ).orderBy(vendorDailyPaymentsTable.paidAt),
    ]);

    const priceMap = getCachedProfilePricesSync(routerId);
    const lower    = new Map<string, number>();
    for (const [k, v] of priceMap) lower.set(k.toLowerCase(), Number(v));
    const resolveUnit = (name: string) => lower.get(name.toLowerCase()) ?? 0;

    const salesMap = new Map<number | null, { count: number; amount: number }>();
    for (const v of vendors) salesMap.set(v.id, { count: 0, amount: 0 });
    for (const r of salesRaw) {
      const cnt  = Number(r.cnt);
      const raw  = Math.max(Number(r.salePriceSum), Number(r.priceSum));
      const unit = resolveUnit(r.profileName);
      const amt  = raw > 0 ? raw : cnt * unit;
      const key  = r.vendorId;
      if (!salesMap.has(key)) salesMap.set(key, { count: 0, amount: 0 });
      const s = salesMap.get(key)!;
      s.count  += cnt;
      s.amount += amt;
    }

    // Track weekly lump-sum and daily payments separately so the frontend can
    // show "weekly expected after daily deductions".
    // IMPORTANT: tag chaque versement avec sa source ("weekly" | "daily") pour
    // que le frontend route correctement la suppression vers le bon endpoint
    // (sinon un id de daily-payment peut entrer en collision avec un id de
    // weekly-payment et supprimer la mauvaise ligne).
    const weeklyPaidMap = new Map<number, number>();
    const dailyPaidMap  = new Map<number, number>();
    const paymentsMap = new Map<number, { id: number; amount: number; paidAt: Date; note: string | null; source: "weekly" | "daily" }[]>();
    for (const p of payments) {
      if (!paymentsMap.has(p.vendorId)) paymentsMap.set(p.vendorId, []);
      paymentsMap.get(p.vendorId)!.push({ id: p.id, amount: p.amount, paidAt: p.paidAt, note: p.note, source: "weekly" });
      weeklyPaidMap.set(p.vendorId, (weeklyPaidMap.get(p.vendorId) ?? 0) + p.amount);
    }
    // Merge daily payments into the same list (tagged source="daily" so the
    // frontend uses /api/vendors/daily-payments/:id pour la suppression).
    for (const p of dailyPayments) {
      if (!paymentsMap.has(p.vendorId)) paymentsMap.set(p.vendorId, []);
      paymentsMap.get(p.vendorId)!.push({ id: p.id, amount: p.amount, paidAt: p.paidAt, note: p.note, source: "daily" });
      dailyPaidMap.set(p.vendorId, (dailyPaidMap.get(p.vendorId) ?? 0) + p.amount);
    }

    const vendorIds = vendors.map((v) => v.id);
    const vendorById = new Map(vendors.map((v) => [v.id, v]));
    const carryOverByVendor = new Map<number, number>();
    if (vendorIds.length > 0) {
      const [historicalSalesRaw, historicalWeeklyPaidRaw, historicalDailyPaidRaw] = await Promise.all([
        db.select({
          vendorId: vouchersTable.vendorId,
          weekStart: sql<string>`date_trunc('week', ${vouchersTable.usedAt})::date::text`,
          amount: sql<number>`coalesce(sum(coalesce(nullif(${vouchersTable.salePrice}, '')::numeric, nullif(${vouchersTable.price}, '')::numeric, 0)), 0)`,
        })
          .from(vouchersTable)
          .where(and(
            eq(vouchersTable.routerId, routerId),
            isNotNull(vouchersTable.usedAt),
            inArray(vouchersTable.vendorId, vendorIds),
            sql`date_trunc('week', ${vouchersTable.usedAt})::date::text < ${weekStart}`,
          ))
          .groupBy(vouchersTable.vendorId, sql`date_trunc('week', ${vouchersTable.usedAt})::date::text`),
        db.select({
          vendorId: vendorPaymentsTable.vendorId,
          weekStart: vendorPaymentsTable.weekStart,
          amount: sql<number>`sum(${vendorPaymentsTable.amount})::int`,
        })
          .from(vendorPaymentsTable)
          .where(and(
            eq(vendorPaymentsTable.routerId, routerId),
            inArray(vendorPaymentsTable.vendorId, vendorIds),
            sql`${vendorPaymentsTable.weekStart} < ${weekStart}`,
            gt(vendorPaymentsTable.amount, 0),
          ))
          .groupBy(vendorPaymentsTable.vendorId, vendorPaymentsTable.weekStart),
        db.select({
          vendorId: vendorDailyPaymentsTable.vendorId,
          weekStart: sql<string>`date_trunc('week', ${vendorDailyPaymentsTable.date}::date)::date::text`,
          amount: sql<number>`sum(${vendorDailyPaymentsTable.amount})::int`,
        })
          .from(vendorDailyPaymentsTable)
          .where(and(
            eq(vendorDailyPaymentsTable.routerId, routerId),
            inArray(vendorDailyPaymentsTable.vendorId, vendorIds),
            sql`${vendorDailyPaymentsTable.date} < ${weekStart}`,
          ))
          .groupBy(vendorDailyPaymentsTable.vendorId, sql`date_trunc('week', ${vendorDailyPaymentsTable.date}::date)::date::text`),
      ]);

      const historicalPaidByVendorWeek = new Map<string, number>();
      const normWeek = (w: unknown) => (typeof w === "string" ? w : (w as Date).toISOString().slice(0, 10));
      for (const p of historicalWeeklyPaidRaw) {
        const k = `${p.vendorId}|${normWeek(p.weekStart)}`;
        historicalPaidByVendorWeek.set(k, (historicalPaidByVendorWeek.get(k) ?? 0) + Number(p.amount || 0));
      }
      for (const p of historicalDailyPaidRaw) {
        const k = `${p.vendorId}|${normWeek(p.weekStart)}`;
        historicalPaidByVendorWeek.set(k, (historicalPaidByVendorWeek.get(k) ?? 0) + Number(p.amount || 0));
      }

      for (const s of historicalSalesRaw) {
        if (!s.vendorId) continue;
        const commRate = vendorById.get(s.vendorId)?.commissionRate ?? 0;
        const expected = Math.max(0, Number(s.amount || 0) - Math.round(Number(s.amount || 0) * commRate) / 100);
        const paid = historicalPaidByVendorWeek.get(`${s.vendorId}|${normWeek(s.weekStart)}`) ?? 0;
        const missing = Math.max(0, Math.round(expected - paid));
        if (missing > 0) {
          carryOverByVendor.set(s.vendorId, (carryOverByVendor.get(s.vendorId) ?? 0) + missing);
        }
      }
    }

    // Commission only applies to completed weeks
    const weekEnded = wEnd.getTime() <= Date.now();

    const result = vendors
      .map((v) => {
        const sales    = salesMap.get(v.id) ?? { count: 0, amount: 0 };
        const paid     = paymentsMap.get(v.id) ?? [];
        const weeklyPaid = weeklyPaidMap.get(v.id) ?? 0;
        const dailyPaid  = dailyPaidMap.get(v.id) ?? 0;
        const totalPaid  = weeklyPaid + dailyPaid;
        const commission = (weekEnded && v.commissionRate > 0)
          ? Math.round(sales.amount * v.commissionRate) / 100
          : 0;
        return {
          vendorId:    v.id,
          vendorName:  v.name,
          count:       sales.count,
          amount:      sales.amount,
          commission,
          commissionRate: weekEnded ? v.commissionRate : 0,
          weeklyPaid,
          dailyPaid,
          totalPaid,
          carryOverAmount: carryOverByVendor.get(v.id) ?? 0,
          weeklyExpected: Math.max(0, sales.amount - commission - dailyPaid),
          remaining:   Math.max(0, sales.amount - commission - totalPaid),
          payments:    paid,
        };
      })
      .filter((v) => v.count > 0 || v.payments.length > 0)
      .sort((a, b) => a.vendorName.localeCompare(b.vendorName, "fr"));

    res.json({ weekStart, vendors: result });
  } catch (err) {
    logger.error({ err }, "weekly-summary error");
    res.status(500).json({ error: "Internal error" });
  }
});

/** POST /api/vendors/payments — record a versement */
router.post("/vendors/payments", async (req, res): Promise<void> => {
  try {
    const { vendorId, routerId, weekStart, amount, note } = req.body as {
      vendorId: number; routerId: number; weekStart: string; amount: number; note?: string;
    };
    if (!vendorId || !routerId || !weekStart || !amount) {
      res.status(400).json({ error: "vendorId, routerId, weekStart, amount required" }); return;
    }
    const ws = mondayOf(weekStart);
    const wStart = new Date(ws + "T00:00:00Z");
    const wEnd = new Date(wStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    const weekEnded = wEnd.getTime() <= Date.now();

    const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, +vendorId));
    if (!vendor) { res.status(404).json({ error: "vendor introuvable" }); return; }

    const [salesRow] = await db
      .select({
        amount: sql<number>`coalesce(sum(coalesce(nullif(${vouchersTable.salePrice}, '')::numeric, nullif(${vouchersTable.price}, '')::numeric, 0)), 0)`,
      })
      .from(vouchersTable)
      .where(and(
        eq(vouchersTable.routerId, +routerId),
        eq(vouchersTable.vendorId, +vendorId),
        isNotNull(vouchersTable.usedAt),
        sql`${vouchersTable.usedAt} >= ${wStart.toISOString()}`,
        sql`${vouchersTable.usedAt} < ${wEnd.toISOString()}`,
      ));

    const [weeklyPaidRow] = await db
      .select({ amount: sql<number>`coalesce(sum(${vendorPaymentsTable.amount}), 0)::int` })
      .from(vendorPaymentsTable)
      .where(and(
        eq(vendorPaymentsTable.routerId, +routerId),
        eq(vendorPaymentsTable.vendorId, +vendorId),
        eq(vendorPaymentsTable.weekStart, ws),
      ));
    const [dailyPaidRow] = await db
      .select({ amount: sql<number>`coalesce(sum(${vendorDailyPaymentsTable.amount}), 0)::int` })
      .from(vendorDailyPaymentsTable)
      .where(and(
        eq(vendorDailyPaymentsTable.routerId, +routerId),
        eq(vendorDailyPaymentsTable.vendorId, +vendorId),
        gte(vendorDailyPaymentsTable.date, ws),
        lte(vendorDailyPaymentsTable.date, new Date(wEnd.getTime() - 1).toISOString().slice(0, 10)),
      ));

    const salesAmount = Number(salesRow?.amount ?? 0);
    const commission = weekEnded && (vendor.commissionRate ?? 0) > 0
      ? Math.round(salesAmount * (vendor.commissionRate ?? 0)) / 100
      : 0;
    const expectedNet = Math.max(0, salesAmount - commission);
    const alreadyPaid = Number(weeklyPaidRow?.amount ?? 0) + Number(dailyPaidRow?.amount ?? 0);
    const remaining = Math.max(0, Math.round(expectedNet - alreadyPaid));
    if (remaining <= 0) { res.status(400).json({ error: "Semaine déjà soldée (commission déduite)" }); return; }

    const requested = Math.round(+amount);
    const appliedAmount = Math.min(requested, remaining);
    const [payment] = await db
      .insert(vendorPaymentsTable)
      .values({ vendorId: +vendorId, routerId: +routerId, weekStart: ws, amount: appliedAmount, note: note || null })
      .returning();
    const remainingAfter = Math.max(0, remaining - appliedAmount);
    if (remainingAfter === 0) {
      await autoSettleDailyRowsForValidatedWeek(+routerId, +vendorId, ws, vendor.commissionRate ?? 0);
    }
    invalidateVendorPortalCache(+vendorId);
    res.json({
      ...payment,
      requestedAmount: requested,
      appliedAmount,
      adjusted: appliedAmount !== requested,
      expectedNet,
      remainingAfter,
    });
  } catch (err) {
    logger.error({ err }, "create payment error");
    res.status(500).json({ error: "Internal error" });
  }
});

/** DELETE /api/vendors/payments/:id — cancel a versement */
router.delete("/vendors/payments/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
    const [deleted] = await db
      .delete(vendorPaymentsTable)
      .where(eq(vendorPaymentsTable.id, id))
      .returning({
        vendorId: vendorPaymentsTable.vendorId,
        routerId: vendorPaymentsTable.routerId,
        weekStart: vendorPaymentsTable.weekStart,
        note: vendorPaymentsTable.note,
      });
    if (!deleted) { res.status(404).json({ error: "Versement déjà supprimé ou inexistant" }); return; }
    // If a weekly payment is removed, rollback auto-generated daily-settlement
    // rows for that same week so arrears can reappear naturally.
    const ws = deleted.weekStart;
    const wsDate = new Date(ws + "T00:00:00Z");
    const we = new Date(wsDate.getTime() + 7 * 24 * 60 * 60 * 1000);
    const weStr = new Date(we.getTime() - 1).toISOString().slice(0, 10);
    await db
      .delete(vendorDailyPaymentsTable)
      .where(and(
        eq(vendorDailyPaymentsTable.routerId, deleted.routerId),
        eq(vendorDailyPaymentsTable.vendorId, deleted.vendorId),
        gte(vendorDailyPaymentsTable.date, ws),
        lte(vendorDailyPaymentsTable.date, weStr),
        ilike(vendorDailyPaymentsTable.note, `Soldé auto via validation semaine ${ws}%`),
      ));

    if ((deleted.note ?? "").startsWith("Régularisation auto arriérés")) {
      await db.insert(vendorPaymentsTable).values({
        vendorId: deleted.vendorId,
        routerId: deleted.routerId,
        weekStart: deleted.weekStart,
        amount: 0,
        note: `Suppression manuelle régularisation auto (${new Date().toISOString()})`,
      });
    }
    invalidateVendorPortalCache(deleted.vendorId);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "delete payment error");
    res.status(500).json({ error: "Internal error" });
  }
});

export default router;
