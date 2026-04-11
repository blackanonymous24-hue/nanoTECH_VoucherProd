import { Router } from "express";
import { eq, desc, ne, count, sql, and, gte, lt, isNotNull } from "drizzle-orm";
import { db, vendorsTable, vouchersTable, routersTable, vendorPaymentsTable, vendorDailyPaymentsTable, profilesCacheTable } from "@workspace/db";
import { verifyPassword, hashPassword, createToken, verifyToken } from "../lib/vendor-auth.js";
import { syncMikrotikUsersToVendor } from "../lib/vendor-sync.js";
import { getCachedProfilePrices, getCachedProfilePricesSync } from "../lib/profile-cache.js";
import { type RouterConnection } from "../lib/mikrotik.js";

const router = Router();

/* ── Generic in-memory TTL cache ────────────────────────────── */
const _cache = new Map<string, { data: unknown; exp: number }>();
function cGet(k: string) { const e = _cache.get(k); return (e && Date.now() < e.exp) ? e.data : null; }
function cSet(k: string, ttl: number, d: unknown) { _cache.set(k, { data: d, exp: Date.now() + ttl }); }

/* period-sales TTLs: yesterday/week are immutable → 1h; today → 45s; month → 2 min */
const PSC_TTL: Record<string, number> = {
  today: 45_000, yesterday: 3_600_000, week: 3_600_000, month: 120_000,
};
/* dashboard TTLs */
const DASH_TTL     = 20_000;   // /vendor-portal/me  (15s refresh cycle + buffer)
const PAYMENTS_TTL = 30_000;   // /vendor-portal/me/payments
const ARREARS_TTL  = 45_000;   // /vendor-portal/me/daily-arrears

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
    todaySold:       sql<number>`cast(count(*) filter (where ${vouchersTable.printedAt} >= current_date and ${vouchersTable.printedAt} < current_date + interval '1 day') as int)`,
    todayAmount:     sql<number>`coalesce(sum(${priceExpr}) filter (where ${vouchersTable.printedAt} >= current_date and ${vouchersTable.printedAt} < current_date + interval '1 day'), 0)`,
    yesterdaySold:   sql<number>`cast(count(*) filter (where ${vouchersTable.printedAt} >= current_date - interval '1 day' and ${vouchersTable.printedAt} < current_date) as int)`,
    yesterdayAmount: sql<number>`coalesce(sum(${priceExpr}) filter (where ${vouchersTable.printedAt} >= current_date - interval '1 day' and ${vouchersTable.printedAt} < current_date), 0)`,
    weekSold:        sql<number>`cast(count(*) filter (where ${vouchersTable.printedAt} >= date_trunc('week', current_date - interval '1 week') and ${vouchersTable.printedAt} < date_trunc('week', current_date)) as int)`,
    weekAmount:      sql<number>`coalesce(sum(${priceExpr}) filter (where ${vouchersTable.printedAt} >= date_trunc('week', current_date - interval '1 week') and ${vouchersTable.printedAt} < date_trunc('week', current_date)), 0)`,
    lastMonthSold:   sql<number>`cast(count(*) filter (where ${vouchersTable.printedAt} >= date_trunc('month', current_date) and ${vouchersTable.printedAt} < date_trunc('month', current_date) + interval '1 month') as int)`,
    lastMonthAmount: sql<number>`coalesce(sum(${priceExpr}) filter (where ${vouchersTable.printedAt} >= date_trunc('month', current_date) and ${vouchersTable.printedAt} < date_trunc('month', current_date) + interval '1 month'), 0)`,
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

  // ── Cache check ──────────────────────────────────────────────────────
  const dashKey = `dash:${id}`;
  const dashHit = cGet(dashKey);
  if (dashHit) { res.json(dashHit); return; }

  const [vendor] = await db
    .select()
    .from(vendorsTable)
    .where(eq(vendorsTable.id, id));

  if (!vendor || !vendor.isActive) {
    res.status(403).json({ error: "Compte introuvable ou désactivé" });
    return;
  }

  // Sync MikroTik users — throttled (2 min TTL) so typically instant.
  // Run BEFORE the DB queries to ensure counts are accurate.
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

  // ── Parallelize router fetch + all 6 DB queries ───────────────────────
  const [routerRow, [totalsRows, byProfileRaw, [periodStatsRow], recentSales, availableVouchers, validProfileRows]] = await Promise.all([
    vendor.routerId
      ? db.select().from(routersTable).where(eq(routersTable.id, vendor.routerId)).then((r) => r[0] ?? null)
      : Promise.resolve(null as typeof routersTable.$inferSelect | null),
    Promise.all([
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
        .where(and(
          eq(vouchersTable.vendorId, id),
          isNotNull(vouchersTable.printedAt),
          gte(vouchersTable.printedAt, new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)),
        ))
        .orderBy(desc(vouchersTable.printedAt)),
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
    ]),
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

  const dashPayload = {
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
  };
  cSet(dashKey, DASH_TTL, dashPayload);
  res.json(dashPayload);
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
      isNotNull(vouchersTable.printedAt),
      gte(vouchersTable.printedAt, start),
      lt(vouchersTable.printedAt, end),
    ))
    .orderBy(desc(vouchersTable.printedAt));

  const revenue = vouchers.reduce((acc, v) => acc + (parseFloat(v.salePrice || v.price || "0") || 0), 0);

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

  const cacheKey = `ps:${payload.vendorId}:${period}`;
  const hit = cGet(cacheKey);
  if (hit) { res.json(hit); return; }

  const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, payload.vendorId));
  if (!vendor || !vendor.isActive) { res.status(403).json({ error: "Compte introuvable ou désactivé" }); return; }

  const id = payload.vendorId;

  const periodFilter =
    period === "today"
      ? sql`${vouchersTable.printedAt} is not null and ${vouchersTable.printedAt} >= current_date and ${vouchersTable.printedAt} < current_date + interval '1 day'`
    : period === "yesterday"
      ? sql`${vouchersTable.printedAt} is not null and ${vouchersTable.printedAt} >= current_date - interval '1 day' and ${vouchersTable.printedAt} < current_date`
    : period === "week"
      ? sql`${vouchersTable.printedAt} is not null and ${vouchersTable.printedAt} >= date_trunc('week', current_date - interval '1 week') and ${vouchersTable.printedAt} < date_trunc('week', current_date)`
      : sql`${vouchersTable.printedAt} is not null and ${vouchersTable.printedAt} >= date_trunc('month', current_date) and ${vouchersTable.printedAt} < date_trunc('month', current_date) + interval '1 month'`;

  const labels: Record<string, string> = {
    today: "Aujourd'hui",
    yesterday: "Hier",
    week: "Semaine dernière",
    month: "Mois en cours",
  };

  // Run vouchers, byProfile, router details and profilesCache all in parallel
  const [vouchers, byProfileRaw, routerRow, cachedPeriodProfiles] = await Promise.all([
    db
      .select()
      .from(vouchersTable)
      .where(and(eq(vouchersTable.vendorId, id), periodFilter))
      .orderBy(desc(vouchersTable.printedAt)),
    db
      .select({
        profileName: vouchersTable.profileName,
        count: count(),
        revenue: sql<number>`coalesce(sum(coalesce(nullif(trim(${vouchersTable.salePrice}),''), nullif(trim(${vouchersTable.price}),''), '0')::numeric), 0)`,
      })
      .from(vouchersTable)
      .where(and(eq(vouchersTable.vendorId, id), periodFilter))
      .groupBy(vouchersTable.profileName)
      .orderBy(desc(count())),
    vendor.routerId
      ? db.select().from(routersTable).where(eq(routersTable.id, vendor.routerId)).then(r => r[0] ?? null)
      : Promise.resolve(null),
    vendor.routerId
      ? db.select({ profileName: profilesCacheTable.profileName }).from(profilesCacheTable).where(eq(profilesCacheTable.routerId, vendor.routerId))
      : Promise.resolve([] as { profileName: string }[]),
  ]);

  // Enrich byProfile with real prices — getCachedProfilePrices is in-memory cached so near-instant
  let periodPriceMap = new Map<string, string>();
  if (routerRow) {
    const conn: RouterConnection = { host: routerRow.host, port: routerRow.port, username: routerRow.username, password: routerRow.password };
    periodPriceMap = await getCachedProfilePrices(vendor.routerId!, conn);
  }

  const validPeriodProfileNames = new Set(cachedPeriodProfiles.map((c) => c.profileName));

  const filteredByProfileRaw = byProfileRaw.filter(
    (row) =>
      row.profileName &&
      row.profileName.trim() !== "" &&
      (validPeriodProfileNames.size === 0 || validPeriodProfileNames.has(row.profileName)),
  );
  const byProfile = filteredByProfileRaw.map((row) => ({ ...row, price: periodPriceMap.get(row.profileName) ?? "" }));

  const revenue = vouchers.reduce((acc, v) => acc + (parseFloat(v.salePrice || v.price || "0") || 0), 0);

  const result = { period, label: labels[period!], total: vouchers.length, revenue, byProfile, vouchers };
  cSet(cacheKey, PSC_TTL[period!] ?? 45_000, result);
  res.json(result);
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

  const paymentsKey = `payments:${payload.vendorId}`;
  const paymentsHit = cGet(paymentsKey);
  if (paymentsHit) { res.json(paymentsHit); return; }

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

  const paymentsPayload = { weeks: result };
  cSet(paymentsKey, PAYMENTS_TTL, paymentsPayload);
  res.json(paymentsPayload);
});

/* ── GET /vendor-portal/me/daily-arrears ────────────────────────────── */
router.get("/vendor-portal/me/daily-arrears", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) { res.status(401).json({ error: "Non authentifié" }); return; }
  const payload = verifyToken(auth.slice(7));
  if (!payload) { res.status(401).json({ error: "Token invalide ou expiré" }); return; }

  const arrearsKey = `arrears:${payload.vendorId}`;
  const arrearsHit = cGet(arrearsKey);
  if (arrearsHit) { res.json(arrearsHit); return; }

  const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, payload.vendorId));
  if (!vendor || !vendor.isActive || !vendor.routerId) {
    res.json({ days: [] }); return;
  }

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const since = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000);
  const sinceStr = since.toISOString().slice(0, 10);

  const [salesRows, paymentRows] = await Promise.all([
    db.select({
      date:   sql<string>`date(${vouchersTable.printedAt} at time zone 'UTC')::text`,
      count:  sql<number>`count(*)::int`,
      amount: sql<number>`greatest(coalesce(sum(nullif(${vouchersTable.salePrice},'')::numeric),0), coalesce(sum(nullif(${vouchersTable.price},'')::numeric),0))::int`,
    })
    .from(vouchersTable)
    .where(and(
      eq(vouchersTable.vendorId, vendor.id),
      isNotNull(vouchersTable.printedAt),
      sql`date(${vouchersTable.printedAt} at time zone 'UTC') >= ${sinceStr}::date`,
      sql`date(${vouchersTable.printedAt} at time zone 'UTC') < ${todayStr}::date`,
    ))
    .groupBy(sql`date(${vouchersTable.printedAt} at time zone 'UTC')`)
    .orderBy(sql`date(${vouchersTable.printedAt} at time zone 'UTC') desc`),

    db.select({
      date: vendorDailyPaymentsTable.date,
      paid: sql<number>`sum(${vendorDailyPaymentsTable.amount})::int`,
    })
    .from(vendorDailyPaymentsTable)
    .where(and(
      eq(vendorDailyPaymentsTable.vendorId, vendor.id),
      gte(vendorDailyPaymentsTable.date, sinceStr),
      lt(vendorDailyPaymentsTable.date, todayStr),
    ))
    .groupBy(vendorDailyPaymentsTable.date),
  ]);

  // Normalize payment dates to "YYYY-MM-DD" strings (pg may return Date objects).
  const paidMap = new Map(paymentRows.map((p) => {
    const key = typeof p.date === "string" ? p.date : (p.date as Date).toISOString().slice(0, 10);
    return [key, Number(p.paid)] as [string, number];
  }));
  const salesMap = new Map(salesRows.map((d) => [d.date, d.amount]));

  // Find the most recently settled week (Mon–Sun).
  // A week is "settled" when the TOTAL paid for that week >= TOTAL sales for that week.
  // (A vendor may pay in one lump sum, so we compare weekly totals, not day-by-day.)
  // Any dates before the Monday of that settled week are hidden from the vendor.
  function getMondayOf(dateStr: string): string {
    const d = new Date(dateStr + "T00:00:00Z");
    const dow = d.getUTCDay(); // 0=Sun
    const diff = dow === 0 ? -6 : 1 - dow;
    return new Date(d.getTime() + diff * 86_400_000).toISOString().slice(0, 10);
  }

  const weekMondaysSet = new Set<string>();
  for (const row of salesRows) weekMondaysSet.add(getMondayOf(row.date));
  // Also include payment weeks so lump-sum payments on days with no sales are counted.
  for (const row of paymentRows) {
    const dateStr = typeof row.date === "string" ? row.date : (row.date as Date).toISOString().slice(0, 10);
    weekMondaysSet.add(getMondayOf(dateStr));
  }
  const weekMondays = [...weekMondaysSet].sort().reverse(); // most recent first

  let cutoffDate: string | null = null;
  for (const monday of weekMondays) {
    const weekStart = new Date(monday + "T00:00:00Z");
    let weekTotalSales = 0;
    let weekTotalPaid  = 0;
    for (let i = 0; i < 7; i++) {
      const dateStr = new Date(weekStart.getTime() + i * 86_400_000).toISOString().slice(0, 10);
      weekTotalSales += salesMap.get(dateStr) ?? 0;
      weekTotalPaid  += paidMap.get(dateStr)  ?? 0;
    }
    if (weekTotalSales > 0 && weekTotalPaid >= weekTotalSales) { cutoffDate = monday; break; }
  }

  const days = salesRows
    .map((d) => {
      const paid = paidMap.get(d.date) ?? 0;
      return { date: d.date, count: d.count, amount: d.amount, paid, remaining: Math.max(0, d.amount - paid) };
    })
    .filter((d) => d.remaining > 0 && (!cutoffDate || d.date >= cutoffDate));

  const arrearsPayload = { days };
  cSet(arrearsKey, ARREARS_TTL, arrearsPayload);
  res.json(arrearsPayload);
});

export default router;
