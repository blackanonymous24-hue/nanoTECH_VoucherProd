import { Router } from "express";
import { eq, desc, ne, count, sql, and, gte, lt, isNotNull } from "drizzle-orm";
import { db, vendorsTable, vouchersTable, routersTable, vendorPaymentsTable, profilesCacheTable } from "@workspace/db";
import { verifyPassword, hashPassword, createToken, verifyToken } from "../lib/vendor-auth.js";
import { syncMikrotikUsersToVendor } from "../lib/vendor-sync.js";
import { getCachedProfilePrices, getCachedProfilePricesSync } from "../lib/profile-cache.js";
import { type RouterConnection } from "../lib/mikrotik.js";

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

/**
 * Portal period stats: counts + amounts computed directly from DB.
 * Amounts use COALESCE(sale_price, price) so no dependency on MikroTik cache.
 * 'weekSold' = last calendar week (Mon–Sun), 'lastMonthSold' = current month.
 */
function buildPortalPeriodStats(vendorId: number) {
  const priceExpr = sql`coalesce(nullif(trim(${vouchersTable.salePrice}), ''), nullif(trim(${vouchersTable.price}), ''), '0')::numeric`;
  return db.select({
    todaySold:       sql<number>`cast(count(*) filter (where ${vouchersTable.usedAt} >= current_date and ${vouchersTable.usedAt} < current_date + interval '1 day') as int)`,
    todayAmount:     sql<number>`coalesce(sum(${priceExpr}) filter (where ${vouchersTable.usedAt} >= current_date and ${vouchersTable.usedAt} < current_date + interval '1 day'), 0)`,
    yesterdaySold:   sql<number>`cast(count(*) filter (where ${vouchersTable.usedAt} >= current_date - interval '1 day' and ${vouchersTable.usedAt} < current_date) as int)`,
    yesterdayAmount: sql<number>`coalesce(sum(${priceExpr}) filter (where ${vouchersTable.usedAt} >= current_date - interval '1 day' and ${vouchersTable.usedAt} < current_date), 0)`,
    weekSold:        sql<number>`cast(count(*) filter (where ${vouchersTable.usedAt} >= date_trunc('week', current_date - interval '1 week') and ${vouchersTable.usedAt} < date_trunc('week', current_date)) as int)`,
    weekAmount:      sql<number>`coalesce(sum(${priceExpr}) filter (where ${vouchersTable.usedAt} >= date_trunc('week', current_date - interval '1 week') and ${vouchersTable.usedAt} < date_trunc('week', current_date)), 0)`,
    lastMonthSold:   sql<number>`cast(count(*) filter (where ${vouchersTable.usedAt} >= date_trunc('month', current_date) and ${vouchersTable.usedAt} < date_trunc('month', current_date) + interval '1 month') as int)`,
    lastMonthAmount: sql<number>`coalesce(sum(${priceExpr}) filter (where ${vouchersTable.usedAt} >= date_trunc('month', current_date) and ${vouchersTable.usedAt} < date_trunc('month', current_date) + interval '1 month'), 0)`,
  })
  .from(vouchersTable)
  .where(eq(vouchersTable.vendorId, vendorId));
}

router.post("/vendor-portal/login", async (req, res): Promise<void> => {
  const { username, password } = req.body as { username?: string; password?: string };

  if (!username || !password) {
    res.status(400).json({ error: "Identifiants requis" });
    return;
  }

  const [vendor] = await db
    .select()
    .from(vendorsTable)
    .where(eq(vendorsTable.username, username.trim()));

  if (!vendor || !vendor.passwordHash) {
    res.status(401).json({ error: "Identifiants incorrects" });
    return;
  }

  if (!vendor.isActive) {
    res.status(403).json({ error: "Compte désactivé" });
    return;
  }

  const valid = await verifyPassword(password, vendor.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Identifiants incorrects" });
    return;
  }

  const token = createToken(vendor.id);
  res.json({
    token,
    vendor: {
      id: vendor.id,
      name: vendor.name,
      email: vendor.email,
      username: vendor.username,
    },
  });
});

router.get("/vendor-portal/me", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Non authentifié" });
    return;
  }

  const payload = verifyToken(auth.slice(7));
  if (!payload) {
    res.status(401).json({ error: "Token invalide ou expiré" });
    return;
  }

  const id = payload.vendorId;

  const [vendor] = await db
    .select()
    .from(vendorsTable)
    .where(eq(vendorsTable.id, id));

  if (!vendor || !vendor.isActive) {
    res.status(403).json({ error: "Compte introuvable ou désactivé" });
    return;
  }

  const routerRow = vendor.routerId
    ? await db.select().from(routersTable).where(eq(routersTable.id, vendor.routerId)).then((r) => r[0] ?? null)
    : null;

  // Sync MikroTik users before building response so counts are accurate.
  // Throttled by SYNC_TTL (2 min) so most calls return instantly.
  if (vendor.routerId) {
    const suffixes = [vendor.commentSuffix, vendor.commentSuffix2].filter(Boolean) as string[];
    await syncMikrotikUsersToVendor(vendor.id, vendor.routerId, suffixes);
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  // Only show vouchers from the vendor's current router with a non-blank profileName
  const byProfileConditions = and(
    eq(vouchersTable.vendorId, id),
    isNotNull(vouchersTable.profileName),
    ne(vouchersTable.profileName, ""),
    ...(vendor.routerId != null ? [eq(vouchersTable.routerId, vendor.routerId)] : []),
  );

  const [totalsRows, byProfileRaw, [periodStatsRow], recentSales, availableVouchers, validProfileRows] = await Promise.all([
    buildTotals(id),
    db
      .select({
        profileName:    vouchersTable.profileName,
        total:          count(),
        printed:        sql<number>`count(*) filter (where ${vouchersTable.printedAt} is not null)`,
        used:           sql<number>`count(*) filter (where ${vouchersTable.usedAt} is not null)`,
        soldToday:      sql<number>`cast(count(*) filter (where ${vouchersTable.usedAt} >= ${startOfDay}) as int)`,
        soldThisMonth:  sql<number>`cast(count(*) filter (where ${vouchersTable.usedAt} >= ${startOfMonth}) as int)`,
      })
      .from(vouchersTable)
      .where(byProfileConditions)
      .groupBy(vouchersTable.profileName)
      .orderBy(desc(count())),
    buildPortalPeriodStats(id),
    db
      .select()
      .from(vouchersTable)
      .where(and(eq(vouchersTable.vendorId, id), isNotNull(vouchersTable.usedAt)))
      .orderBy(desc(vouchersTable.usedAt))
      .limit(30),
    db
      .select()
      .from(vouchersTable)
      .where(eq(vouchersTable.vendorId, id))
      .orderBy(desc(vouchersTable.createdAt)),
    // Fetch currently valid profiles from the local cache (reflects live MikroTik state)
    vendor.routerId != null
      ? db.select({ profileName: profilesCacheTable.profileName })
          .from(profilesCacheTable)
          .where(eq(profilesCacheTable.routerId, vendor.routerId))
      : Promise.resolve([] as { profileName: string }[]),
  ]);

  // Build a set of profiles that still exist in MikroTik
  const validProfileNames = new Set(validProfileRows.map((r) => r.profileName));

  // Profile price cache (still used to enrich byProfile and recentSales display)
  let priceMap = new Map<string, string>();
  if (routerRow && vendor.routerId) {
    const conn: RouterConnection = { host: routerRow.host, port: routerRow.port, username: routerRow.username, password: routerRow.password };
    priceMap = getCachedProfilePricesSync(vendor.routerId, conn);
  }

  // Filter out profiles that no longer exist in MikroTik (only when cache is populated)
  const byProfile = byProfileRaw
    .filter((row) => validProfileNames.size === 0 || validProfileNames.has(row.profileName))
    .map((row) => ({ ...row, price: priceMap.get(row.profileName) ?? "" }));

  const totals = totalsRows[0];
  // Compute totalAvailable from byProfile (already filtered by routerId + valid profileName)
  // so Home card matches the per-profile breakdown exactly.
  const totalAvailable = byProfile.reduce(
    (sum, p) => sum + (Number(p.total) - Number(p.used ?? 0)),
    0,
  );

  const salesStats = {
    todaySold:       Number(periodStatsRow?.todaySold       ?? 0),
    todayAmount:     Number(periodStatsRow?.todayAmount      ?? 0),
    yesterdaySold:   Number(periodStatsRow?.yesterdaySold    ?? 0),
    yesterdayAmount: Number(periodStatsRow?.yesterdayAmount  ?? 0),
    weekSold:        Number(periodStatsRow?.weekSold         ?? 0),
    weekAmount:      Number(periodStatsRow?.weekAmount       ?? 0),
    lastMonthSold:   Number(periodStatsRow?.lastMonthSold    ?? 0),
    lastMonthAmount: Number(periodStatsRow?.lastMonthAmount  ?? 0),
  };

  res.json({
    vendor: { id: vendor.id, name: vendor.name, email: vendor.email, username: vendor.username },
    hotspotName: routerRow?.hotspotName ?? null,
    totalVouchers:  totals?.total        ?? 0,
    totalAvailable,
    totalPrinted:   Number(totals?.printed ?? 0),
    totalUsed:      Number(totals?.used    ?? 0),
    salesStats,
    byProfile,
    recentSales: recentSales.map((v) => ({
      ...v,
      // Enrich: use salePrice (from sync), else price (from generation), else profile cache
      price: v.salePrice || v.price || priceMap.get(v.profileName) || "",
    })),
    availableVouchers: availableVouchers.filter((v) => v.usedAt === null),
  });
});

router.get("/vendor-portal/me/report", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) { res.status(401).json({ error: "Non authentifié" }); return; }
  const payload = verifyToken(auth.slice(7));
  if (!payload) { res.status(401).json({ error: "Token invalide ou expiré" }); return; }

  const { day, month, year } = req.query as { day?: string; month?: string; year?: string };
  const d = parseInt(day ?? "", 10);
  const m = parseInt(month ?? "", 10);
  const y = parseInt(year ?? "", 10);
  if (!d || !m || !y || d < 1 || d > 31 || m < 1 || m > 12 || y < 2020) {
    res.status(400).json({ error: "Date invalide" }); return;
  }

  const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, payload.vendorId));
  if (!vendor || !vendor.isActive) { res.status(403).json({ error: "Compte introuvable ou désactivé" }); return; }

  const startStr = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const start = new Date(`${startStr}T00:00:00Z`);
  const end   = new Date(start.getTime() + 86_400_000);

  const vouchers = await db
    .select()
    .from(vouchersTable)
    .where(and(
      eq(vouchersTable.vendorId, payload.vendorId),
      gte(vouchersTable.usedAt, start),
      lt(vouchersTable.usedAt, end),
    ))
    .orderBy(desc(vouchersTable.usedAt));

  const revenue = vouchers.reduce((acc, v) => acc + (parseFloat(v.price ?? "0") || 0), 0);

  res.json({ date: startStr, total: vouchers.length, revenue, vouchers });
});

router.get("/vendor-portal/me/period-sales", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) { res.status(401).json({ error: "Non authentifié" }); return; }
  const payload = verifyToken(auth.slice(7));
  if (!payload) { res.status(401).json({ error: "Token invalide ou expiré" }); return; }

  const { period } = req.query as { period?: string };
  if (!["today", "yesterday", "week", "month"].includes(period ?? "")) {
    res.status(400).json({ error: "Période invalide" }); return;
  }

  const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, payload.vendorId));
  if (!vendor || !vendor.isActive) { res.status(403).json({ error: "Compte introuvable ou désactivé" }); return; }

  const id = payload.vendorId;

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
        revenue: sql<number>`coalesce(sum(nullif(${vouchersTable.price}, '')::numeric), 0)`,
      })
      .from(vouchersTable)
      .where(and(eq(vouchersTable.vendorId, id), periodFilter))
      .groupBy(vouchersTable.profileName)
      .orderBy(desc(count())),
  ]);

  // Enrich byProfile with real prices from MikroTik profiles + filter deleted/renamed profiles
  let periodPriceMap = new Map<string, string>();
  if (vendor.routerId) {
    const [routerForPeriod] = await db.select().from(routersTable).where(eq(routersTable.id, vendor.routerId));
    if (routerForPeriod) {
      const conn: RouterConnection = { host: routerForPeriod.host, port: routerForPeriod.port, username: routerForPeriod.username, password: routerForPeriod.password };
      periodPriceMap = await getCachedProfilePrices(vendor.routerId, conn);
    }
  }

  // Filter: only show profiles that still exist in MikroTik (from profilesCache)
  // This ensures renamed profiles show the new name and deleted profiles are hidden.
  // When cache is empty (first boot), all non-empty profiles are shown as fallback.
  let validPeriodProfileNames = new Set<string>();
  if (vendor.routerId) {
    const cachedPeriodProfiles = await db
      .select({ profileName: profilesCacheTable.profileName })
      .from(profilesCacheTable)
      .where(eq(profilesCacheTable.routerId, vendor.routerId));
    validPeriodProfileNames = new Set(cachedPeriodProfiles.map((c) => c.profileName));
  }

  const filteredByProfileRaw = byProfileRaw.filter(
    (row) =>
      row.profileName &&
      row.profileName.trim() !== "" &&
      (validPeriodProfileNames.size === 0 || validPeriodProfileNames.has(row.profileName)),
  );
  const byProfile = filteredByProfileRaw.map((row) => ({ ...row, price: periodPriceMap.get(row.profileName) ?? "" }));

  const revenue = vouchers.reduce((acc, v) => acc + (parseFloat(v.price ?? "0") || 0), 0);

  res.json({ period, label: labels[period!], total: vouchers.length, revenue, byProfile, vouchers });
});

/* ── PUT /vendor-portal/me/password ─────────────────────────────────── */
router.put("/vendor-portal/me/password", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) { res.status(401).json({ error: "Non authentifié" }); return; }
  const payload = verifyToken(auth.slice(7));
  if (!payload) { res.status(401).json({ error: "Token invalide ou expiré" }); return; }

  const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "Champs requis manquants" }); return;
  }
  if (newPassword.length < 4) {
    res.status(400).json({ error: "Le nouveau mot de passe doit comporter au moins 4 caractères" }); return;
  }

  const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, payload.vendorId));
  if (!vendor || !vendor.passwordHash) { res.status(404).json({ error: "Vendeur introuvable" }); return; }

  const valid = await verifyPassword(currentPassword, vendor.passwordHash);
  if (!valid) { res.status(401).json({ error: "Ancien mot de passe incorrect" }); return; }

  const passwordHash = await hashPassword(newPassword);
  await db.update(vendorsTable).set({ passwordHash }).where(eq(vendorsTable.id, vendor.id));

  res.json({ success: true });
});

/* ── GET /vendor-portal/me/payments ─────────────────────────────────── */
router.get("/vendor-portal/me/payments", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) { res.status(401).json({ error: "Non authentifié" }); return; }
  const payload = verifyToken(auth.slice(7));
  if (!payload) { res.status(401).json({ error: "Token invalide ou expiré" }); return; }

  const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, payload.vendorId));
  if (!vendor || !vendor.isActive || !vendor.routerId) {
    res.json({ weeks: [] }); return;
  }

  const routerId = vendor.routerId;

  // Compute Monday for current and last week
  function monday(offsetWeeks: number): string {
    const now = new Date();
    const day = now.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    const mon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diff + offsetWeeks * 7));
    return mon.toISOString().slice(0, 10);
  }

  const weeks = [monday(0), monday(-1)]; // current week, last week

  // price map for the router
  const priceMap = getCachedProfilePricesSync(routerId);
  const lower = new Map<string, number>();
  for (const [k, v] of priceMap) lower.set(k.toLowerCase(), parseFloat(String(v).replace(/[^0-9.]/g, "")) || 0);
  const resolveUnit = (name: string) => lower.get(name.toLowerCase()) ?? 0;

  const result = await Promise.all(weeks.map(async (weekStart) => {
    const wStart = new Date(weekStart + "T00:00:00Z");
    const wEnd   = new Date(wStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [salesRaw, payments] = await Promise.all([
      db.select({
        profileName:  vouchersTable.profileName,
        cnt:          sql<number>`count(*)`,
        salePriceSum: sql<number>`coalesce(sum(nullif(${vouchersTable.salePrice},'')::numeric), 0)`,
        priceSum:     sql<number>`coalesce(sum(nullif(${vouchersTable.price},'')::numeric), 0)`,
      })
      .from(vouchersTable)
      .where(and(
        eq(vouchersTable.vendorId, vendor.id),
        isNotNull(vouchersTable.usedAt),
        sql`${vouchersTable.usedAt} >= ${wStart.toISOString()}`,
        sql`${vouchersTable.usedAt} <  ${wEnd.toISOString()}`,
      ))
      .groupBy(vouchersTable.profileName),

      db.select().from(vendorPaymentsTable).where(and(
        eq(vendorPaymentsTable.vendorId, vendor.id),
        eq(vendorPaymentsTable.routerId, routerId),
        eq(vendorPaymentsTable.weekStart, weekStart),
      )).orderBy(vendorPaymentsTable.paidAt),
    ]);

    let count = 0;
    let amount = 0;
    for (const r of salesRaw) {
      const cnt = Number(r.cnt);
      const raw = Math.max(Number(r.salePriceSum), Number(r.priceSum));
      const amt = Math.max(raw, cnt * resolveUnit(r.profileName));
      count  += cnt;
      amount += amt;
    }

    const totalPaid = payments.reduce((s, p) => s + p.amount, 0);

    // Week label: "dd Mmm – dd Mmm yyyy"
    const MONTHS_FR = ["Jan","Fév","Mar","Avr","Mai","Juin","Juil","Août","Sep","Oct","Nov","Déc"];
    const sun = new Date(wStart.getTime() + 6 * 24 * 60 * 60 * 1000);
    const fmt = (d: Date) => `${String(d.getUTCDate()).padStart(2,"0")} ${MONTHS_FR[d.getUTCMonth()]}`;
    const label = `${fmt(wStart)} – ${fmt(sun)} ${sun.getUTCFullYear()}`;

    // Commission applies only once the week is fully over
    const weekEnded = wEnd.getTime() <= Date.now();
    const commission = (weekEnded && vendor.commissionRate > 0) ? Math.round(amount * vendor.commissionRate) / 100 : 0;
    const effectiveCommissionRate = weekEnded ? vendor.commissionRate : 0;

    return {
      weekStart,
      label,
      count,
      amount,
      commission,
      commissionRate: effectiveCommissionRate,
      totalPaid,
      remaining: Math.max(0, amount - commission - totalPaid),
      payments: payments.map((p) => ({ id: p.id, amount: p.amount, paidAt: p.paidAt, note: p.note })),
    };
  }));

  res.json({ weeks: result });
});

export default router;
