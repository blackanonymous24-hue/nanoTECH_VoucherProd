import { Router } from "express";
import { eq, desc, count, sql, isNull, isNotNull } from "drizzle-orm";
import { db, vendorsTable, vouchersTable } from "@workspace/db";
import { verifyPassword, createToken, verifyToken } from "../lib/vendor-auth.js";

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
        ${vouchersTable.printedAt} >= date_trunc('week', current_date)
        and ${vouchersTable.printedAt} < current_date + interval '1 day'
      )`,
    lastMonthSold: sql<number>`
      count(*) filter (where
        ${vouchersTable.printedAt} >= date_trunc('month', current_date - interval '1 month')
        and ${vouchersTable.printedAt} < date_trunc('month', current_date)
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

  const [totalsRows, byProfile, salesRow, recentSales, availableVouchers] = await Promise.all([
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

  const totals = totalsRows[0];
  const totalAvailable = availableVouchers.filter((v) => v.usedAt === null).length;

  res.json({
    vendor: { id: vendor.id, name: vendor.name, email: vendor.email, username: vendor.username },
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

export default router;
