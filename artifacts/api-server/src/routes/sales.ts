import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, salesTable, vouchersTable, profilesTable, distributorsTable } from "@workspace/db";
import {
  CreateSaleBody,
  GetSalesQueryParams,
  GetSaleParams,
  GetSalesResponse,
  GetSaleResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/sales", async (req, res): Promise<void> => {
  const params = GetSalesQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const limit = params.data.limit ?? 50;
  const offset = params.data.offset ?? 0;

  const sales = await db
    .select()
    .from(salesTable)
    .orderBy(desc(salesTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.json(GetSalesResponse.parse(sales));
});

router.post("/sales", async (req, res): Promise<void> => {
  const parsed = CreateSaleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { profileId, paymentMethod, operatorName, customerName, distributorId } = parsed.data;

  const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.id, profileId));
  if (!profile) {
    res.status(404).json({ error: "Profil introuvable" });
    return;
  }

  const [voucher] = await db
    .select()
    .from(vouchersTable)
    .where(and(
      eq(vouchersTable.profileId, profileId),
      eq(vouchersTable.status, "available")
    ))
    .limit(1);

  if (!voucher) {
    res.status(400).json({ error: "Aucun voucher disponible pour ce profil" });
    return;
  }

  let distributorName: string | null = null;
  if (distributorId) {
    const [dist] = await db.select().from(distributorsTable).where(eq(distributorsTable.id, distributorId));
    distributorName = dist?.name ?? null;
  }

  await db
    .update(vouchersTable)
    .set({ status: "sold", soldAt: new Date() })
    .where(eq(vouchersTable.id, voucher.id));

  const [sale] = await db
    .insert(salesTable)
    .values({
      voucherId: voucher.id,
      voucherCode: voucher.code,
      profileId: profile.id,
      profileName: profile.name,
      amount: profile.price,
      paymentMethod,
      operatorName: operatorName ?? null,
      customerName: customerName ?? null,
      distributorId: distributorId ?? null,
      distributorName,
    })
    .returning();

  res.status(201).json(GetSaleResponse.parse(sale));
});

router.get("/sales/:id", async (req, res): Promise<void> => {
  const params = GetSaleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [sale] = await db.select().from(salesTable).where(eq(salesTable.id, params.data.id));
  if (!sale) {
    res.status(404).json({ error: "Vente introuvable" });
    return;
  }

  res.json(GetSaleResponse.parse(sale));
});

export default router;
