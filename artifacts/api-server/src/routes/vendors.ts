import { Router } from "express";
import { eq, desc, and, count, sql } from "drizzle-orm";
import { db, vendorsTable, vouchersTable } from "@workspace/db";

const router = Router();

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

  const stats = await db
    .select({
      profileName: vouchersTable.profileName,
      total: count(),
      printed: sql<number>`count(*) filter (where ${vouchersTable.printedAt} is not null)`,
    })
    .from(vouchersTable)
    .where(eq(vouchersTable.vendorId, id))
    .groupBy(vouchersTable.profileName)
    .orderBy(desc(count()));

  const totalVouchers = stats.reduce((s, r) => s + r.total, 0);
  const totalPrinted = stats.reduce((s, r) => s + Number(r.printed), 0);

  const recentVouchers = await db
    .select()
    .from(vouchersTable)
    .where(eq(vouchersTable.vendorId, id))
    .orderBy(desc(vouchersTable.createdAt))
    .limit(50);

  res.json({
    vendor,
    totalVouchers,
    totalPrinted,
    byProfile: stats,
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
      const [row] = await db
        .select({
          total: count(),
          printed: sql<number>`count(*) filter (where ${vouchersTable.printedAt} is not null)`,
        })
        .from(vouchersTable)
        .where(eq(vouchersTable.vendorId, vendor.id));

      return {
        vendor,
        totalVouchers: row?.total ?? 0,
        totalPrinted: row ? Number(row.printed) : 0,
      };
    }),
  );

  res.json(summaries);
});

export default router;
