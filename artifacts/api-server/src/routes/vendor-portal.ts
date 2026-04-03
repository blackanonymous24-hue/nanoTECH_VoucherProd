import { Router } from "express";
import { eq, desc, count, sql, and, gte, lt } from "drizzle-orm";
import { db, vendorsTable, vouchersTable, routersTable } from "@workspace/db";
import { verifyPassword, createToken, verifyToken } from "../lib/vendor-auth.js";
import { syncMikrotikUsersToVendor } from "../lib/vendor-sync.js";
import { getCachedProfilePrices } from "../lib/profile-cache.js";
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

function buildSalesStats(vendorId: number) {
  return db.select({
    todaySold: sql<number>`
      count(*) filter (where
        ${vouchersTable.printedAt} >= current_date
        and ${vouchersTable.printedAt} < current_date + interval '1 day'
      )`,
    yesterdaySold: sql<number>`
      count(*) filter (where
        ${vouchersTable.printedAt} >= current_date - interval '1 day'
        and ${vouchersTable.printedAt} < current_date
      )`,
    weekSold: sql<number>`
      count(*) filter (where
        ${vouchersTable.printedAt} >= date_trunc('week', current_date - interval '1 week')
        and ${vouchersTable.printedAt} < date_trunc('week', current_date)
      )`,
    lastMonthSold: sql<number>`
      count(*) filter (where
        ${vouchersTable.printedAt} >= date_trunc('month', current_date)
        and ${vouchersTable.printedAt} < date_trunc('month', current_date) + interval '1 month'
      )`,
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

  // Background sync: import MikroTik hotspot users matching vendor suffixes (non-blocking)
  if (vendor.routerId) {
    const suffixes = [vendor.commentSuffix, vendor.commentSuffix2].filter(Boolean) as string[];
    void syncMikrotikUsersToVendor(vendor.id, vendor.routerId, suffixes);
  }

  const [totalsRows, byProfileRaw, salesRow, recentSales, availableVouchers] = await Promise.all([
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
    buildSalesStats(id).then((rows) => rows[0]),
    db
      .select()
      .from(vouchersTable)
      .where(eq(vouchersTable.vendorId, id))
      .orderBy(desc(vouchersTable.usedAt))
      .limit(30),
    db
      .select()
      .from(vouchersTable)
      .where(eq(vouchersTable.vendorId, id))
      .orderBy(desc(vouchersTable.createdAt)),
  ]);

  // Enrich byProfile with real prices from MikroTik profiles
  let priceMap = new Map<string, string>();
  if (routerRow && vendor.routerId) {
    const conn: RouterConnection = { host: routerRow.host, port: routerRow.port, username: routerRow.username, password: routerRow.password };
    priceMap = await getCachedProfilePrices(vendor.routerId, conn);
  }
  const byProfile = byProfileRaw.map((row) => ({ ...row, price: priceMap.get(row.profileName) ?? "" }));

  const totals = totalsRows[0];
  const totalAvailable = availableVouchers.filter((v) => v.usedAt === null).length;

  res.json({
    vendor: { id: vendor.id, name: vendor.name, email: vendor.email, username: vendor.username },
    hotspotName: routerRow?.hotspotName ?? null,
    totalVouchers:  totals?.total        ?? 0,
    totalAvailable,
    totalPrinted:   Number(totals?.printed ?? 0),
    totalUsed:      Number(totals?.used    ?? 0),
    salesStats: {
      todaySold:     Number(salesRow?.todaySold     ?? 0),
      yesterdaySold: Number(salesRow?.yesterdaySold ?? 0),
      weekSold:      Number(salesRow?.weekSold      ?? 0),
      lastMonthSold: Number(salesRow?.lastMonthSold ?? 0),
    },
    byProfile,
    recentSales: recentSales.filter((v) => v.usedAt !== null),
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
      gte(vouchersTable.printedAt, start),
      lt(vouchersTable.printedAt, end),
    ))
    .orderBy(desc(vouchersTable.printedAt));

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
      ? sql`${vouchersTable.printedAt} >= current_date and ${vouchersTable.printedAt} < current_date + interval '1 day'`
    : period === "yesterday"
      ? sql`${vouchersTable.printedAt} >= current_date - interval '1 day' and ${vouchersTable.printedAt} < current_date`
    : period === "week"
      ? sql`${vouchersTable.printedAt} >= date_trunc('week', current_date - interval '1 week') and ${vouchersTable.printedAt} < date_trunc('week', current_date)`
      : sql`${vouchersTable.printedAt} >= date_trunc('month', current_date) and ${vouchersTable.printedAt} < date_trunc('month', current_date) + interval '1 month'`;

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
      .orderBy(desc(vouchersTable.printedAt)),
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

  // Enrich byProfile with real prices from MikroTik profiles
  let periodPriceMap = new Map<string, string>();
  if (vendor.routerId) {
    const [routerForPeriod] = await db.select().from(routersTable).where(eq(routersTable.id, vendor.routerId));
    if (routerForPeriod) {
      const conn: RouterConnection = { host: routerForPeriod.host, port: routerForPeriod.port, username: routerForPeriod.username, password: routerForPeriod.password };
      periodPriceMap = await getCachedProfilePrices(vendor.routerId, conn);
    }
  }
  const byProfile = byProfileRaw.map((row) => ({ ...row, price: periodPriceMap.get(row.profileName) ?? "" }));

  const revenue = vouchers.reduce((acc, v) => acc + (parseFloat(v.price ?? "0") || 0), 0);

  res.json({ period, label: labels[period!], total: vouchers.length, revenue, byProfile, vouchers });
});

export default router;
