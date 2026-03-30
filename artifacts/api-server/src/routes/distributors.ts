import { Router, type IRouter } from "express";
import { eq, count, sum, gte, desc, and, max } from "drizzle-orm";
import { db, distributorsTable, salesTable } from "@workspace/db";
import {
  CreateDistributorBody,
  UpdateDistributorBody,
  GetDistributorParams,
  UpdateDistributorParams,
  DeleteDistributorParams,
  GetDistributorDailyStatsParams,
  GetDistributorsResponse,
  GetDistributorResponse,
  UpdateDistributorResponse,
  GetDistributorDailyStatsResponse,
  GetDistributorsDailyReportResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/distributors", async (_req, res): Promise<void> => {
  const distributors = await db.select().from(distributorsTable).orderBy(distributorsTable.createdAt);
  res.json(GetDistributorsResponse.parse(distributors));
});

router.post("/distributors", async (req, res): Promise<void> => {
  const parsed = CreateDistributorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = {
    ...parsed.data,
    status: parsed.data.status ?? "active",
  };
  const [distributor] = await db.insert(distributorsTable).values(data).returning();
  res.status(201).json(GetDistributorResponse.parse(distributor));
});

router.get("/distributors/:id", async (req, res): Promise<void> => {
  const params = GetDistributorParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [distributor] = await db
    .select()
    .from(distributorsTable)
    .where(eq(distributorsTable.id, params.data.id));
  if (!distributor) {
    res.status(404).json({ error: "Distributeur introuvable" });
    return;
  }
  res.json(GetDistributorResponse.parse(distributor));
});

router.patch("/distributors/:id", async (req, res): Promise<void> => {
  const params = UpdateDistributorParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateDistributorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [distributor] = await db
    .update(distributorsTable)
    .set(parsed.data)
    .where(eq(distributorsTable.id, params.data.id))
    .returning();
  if (!distributor) {
    res.status(404).json({ error: "Distributeur introuvable" });
    return;
  }
  res.json(UpdateDistributorResponse.parse(distributor));
});

router.delete("/distributors/:id", async (req, res): Promise<void> => {
  const params = DeleteDistributorParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [distributor] = await db
    .delete(distributorsTable)
    .where(eq(distributorsTable.id, params.data.id))
    .returning();
  if (!distributor) {
    res.status(404).json({ error: "Distributeur introuvable" });
    return;
  }
  res.sendStatus(204);
});

router.get("/distributors/:id/daily-stats", async (req, res): Promise<void> => {
  const params = GetDistributorDailyStatsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [distributor] = await db
    .select()
    .from(distributorsTable)
    .where(eq(distributorsTable.id, params.data.id));

  if (!distributor) {
    res.status(404).json({ error: "Distributeur introuvable" });
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [todayRow] = await db
    .select({ total: count(), revenue: sum(salesTable.amount) })
    .from(salesTable)
    .where(and(
      eq(salesTable.distributorId, params.data.id),
      gte(salesTable.createdAt, today)
    ));

  const [allTimeRow] = await db
    .select({ total: count(), revenue: sum(salesTable.amount) })
    .from(salesTable)
    .where(eq(salesTable.distributorId, params.data.id));

  res.json(
    GetDistributorDailyStatsResponse.parse({
      distributorId: distributor.id,
      distributorName: distributor.name,
      vouchersSoldToday: Number(todayRow?.total ?? 0),
      revenueToday: Number(todayRow?.revenue ?? 0),
      vouchersSoldTotal: Number(allTimeRow?.total ?? 0),
      revenueTotal: Number(allTimeRow?.revenue ?? 0),
    })
  );
});

export async function getDistributorsDailyReport() {
  const distributors = await db.select().from(distributorsTable);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const result = await Promise.all(
    distributors.map(async (d) => {
      const [todayRow] = await db
        .select({ total: count(), revenue: sum(salesTable.amount) })
        .from(salesTable)
        .where(and(
          eq(salesTable.distributorId, d.id),
          gte(salesTable.createdAt, today)
        ));

      const [allTimeRow] = await db
        .select({ total: count(), revenue: sum(salesTable.amount) })
        .from(salesTable)
        .where(eq(salesTable.distributorId, d.id));

      const [lastSaleRow] = await db
        .select({ lastSaleAt: max(salesTable.createdAt) })
        .from(salesTable)
        .where(eq(salesTable.distributorId, d.id));

      return {
        distributorId: d.id,
        distributorName: d.name,
        phone: d.phone ?? null,
        status: d.status,
        vouchersSoldToday: Number(todayRow?.total ?? 0),
        revenueToday: Number(todayRow?.revenue ?? 0),
        vouchersSoldTotal: Number(allTimeRow?.total ?? 0),
        revenueTotal: Number(allTimeRow?.revenue ?? 0),
        lastSaleAt: lastSaleRow?.lastSaleAt ?? null,
      };
    })
  );

  return result.sort((a, b) => b.revenueToday - a.revenueToday);
}

router.get("/dashboard/distributors-daily", async (_req, res): Promise<void> => {
  const result = await getDistributorsDailyReport();
  res.json(GetDistributorsDailyReportResponse.parse(result));
});

export default router;
