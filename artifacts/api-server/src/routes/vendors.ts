import { Router } from "express";
import { eq, desc, and, count, sql, isNotNull } from "drizzle-orm";
import { db, vendorsTable, vouchersTable } from "@workspace/db";

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

router.get("/vendors", async (_req, res): Promise<void> => {
  const vendors = await db
    .select()
    .from(vendorsTable)
    .orderBy(vendorsTable.name);
  res.json(vendors);
});

router.post("/vendors", async (req, res): Promise<void> => {
  const { name, phone } = req.body as { name?: string; phone?: string };
  if (!name || name.trim() === "") {
    res.status(400).json({ error: "Le nom du vendeur est requis" });
    return;
  }
  const [vendor] = await db
    .insert(vendorsTable)
    .values({ name: name.trim(), phone: phone?.trim() || null })
    .returning();
  res.status(201).json(vendor);
});

router.put("/vendors/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const { name, phone, isActive } = req.body as {
    name?: string;
    phone?: string;
    isActive?: boolean;
  };

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name.trim();
  if (phone !== undefined) updates.phone = phone?.trim() || null;
  if (isActive !== undefined) updates.isActive = isActive;

  const [vendor] = await db
    .update(vendorsTable)
    .set(updates)
    .where(eq(vendorsTable.id, id))
    .returning();

  if (!vendor) { res.status(404).json({ error: "Vendeur introuvable" }); return; }
  res.json(vendor);
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

router.get("/vendors/:id/report", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [vendor] = await db
    .select()
    .from(vendorsTable)
    .where(eq(vendorsTable.id, id));

  if (!vendor) { res.status(404).json({ error: "Vendeur introuvable" }); return; }

  const [totalsRows, byProfile, salesRow, recentVouchers] = await Promise.all([
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
      .orderBy(desc(vouchersTable.createdAt))
      .limit(50),
  ]);

  const totals = totalsRows[0];

  res.json({
    vendor,
    totalVouchers: totals?.total        ?? 0,
    totalPrinted:  Number(totals?.printed ?? 0),
    totalUsed:     Number(totals?.used    ?? 0),
    salesStats: {
      todaySold:     Number(salesRow?.todaySold     ?? 0),
      yesterdaySold: Number(salesRow?.yesterdaySold ?? 0),
      weekSold:      Number(salesRow?.weekSold      ?? 0),
      lastMonthSold: Number(salesRow?.lastMonthSold ?? 0),
    },
    byProfile,
    recentVouchers,
  });
});

router.get("/vendors/reports/summary", async (_req, res): Promise<void> => {
  const vendors = await db
    .select()
    .from(vendorsTable)
    .orderBy(vendorsTable.name);

  const summaries = await Promise.all(
    vendors.map(async (vendor) => {
      const [[row], [salesRow]] = await Promise.all([
        buildTotals(vendor.id),
        buildSalesStats(vendor.id),
      ]);

      return {
        vendor,
        totalVouchers: row?.total        ?? 0,
        totalPrinted:  Number(row?.printed ?? 0),
        totalUsed:     Number(row?.used    ?? 0),
        salesStats: {
          todaySold:     Number(salesRow?.todaySold     ?? 0),
          yesterdaySold: Number(salesRow?.yesterdaySold ?? 0),
          weekSold:      Number(salesRow?.weekSold      ?? 0),
          lastMonthSold: Number(salesRow?.lastMonthSold ?? 0),
        },
      };
    }),
  );

  res.json(summaries);
});

export default router;
