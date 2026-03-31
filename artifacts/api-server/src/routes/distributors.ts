import { Router, type IRouter } from "express";
import { eq, count, sum, gte, lt, and, max, between } from "drizzle-orm";
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
  VendorLoginBody,
  VendorLoginResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function getDateBounds() {
  const now = new Date();

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const yesterdayEnd = new Date(todayStart);

  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const thisWeekMonday = new Date(todayStart);
  thisWeekMonday.setDate(todayStart.getDate() + diffToMonday);
  const lastWeekMonday = new Date(thisWeekMonday);
  lastWeekMonday.setDate(thisWeekMonday.getDate() - 7);
  const lastWeekEnd = new Date(thisWeekMonday);

  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  return { todayStart, yesterdayStart, yesterdayEnd, lastWeekMonday, lastWeekEnd, currentMonthStart };
}

async function getPeriodStats(distributorId: number | null) {
  const { todayStart, yesterdayStart, yesterdayEnd, lastWeekMonday, lastWeekEnd, currentMonthStart } = getDateBounds();

  const baseWhere = distributorId !== null
    ? (date: Date, endDate?: Date) => and(eq(salesTable.distributorId, distributorId), endDate ? and(gte(salesTable.createdAt, date), lt(salesTable.createdAt, endDate)) : gte(salesTable.createdAt, date))
    : (_date: Date, _endDate?: Date) => undefined;

  const query = (start: Date, end?: Date) => {
    const cond = distributorId !== null
      ? end
        ? and(eq(salesTable.distributorId, distributorId), gte(salesTable.createdAt, start), lt(salesTable.createdAt, end))
        : and(eq(salesTable.distributorId, distributorId), gte(salesTable.createdAt, start))
      : end
        ? and(gte(salesTable.createdAt, start), lt(salesTable.createdAt, end))
        : gte(salesTable.createdAt, start);

    return db.select({ total: count(), revenue: sum(salesTable.amount) }).from(salesTable).where(cond);
  };

  const [todayRow] = await query(todayStart);
  const [yesterdayRow] = await query(yesterdayStart, yesterdayEnd);
  const [lastWeekRow] = await query(lastWeekMonday, lastWeekEnd);
  const [currentMonthRow] = await query(currentMonthStart);

  const allCond = distributorId !== null ? eq(salesTable.distributorId, distributorId) : undefined;
  const [totalRow] = await db.select({ total: count(), revenue: sum(salesTable.amount) }).from(salesTable).where(allCond);
  const [lastSaleRow] = await db.select({ lastSaleAt: max(salesTable.createdAt) }).from(salesTable).where(allCond);

  return {
    vouchersSoldToday: Number(todayRow?.total ?? 0),
    revenueToday: Number(todayRow?.revenue ?? 0),
    vouchersSoldYesterday: Number(yesterdayRow?.total ?? 0),
    revenueYesterday: Number(yesterdayRow?.revenue ?? 0),
    vouchersSoldLastWeek: Number(lastWeekRow?.total ?? 0),
    revenueLastWeek: Number(lastWeekRow?.revenue ?? 0),
    vouchersSoldCurrentMonth: Number(currentMonthRow?.total ?? 0),
    revenueCurrentMonth: Number(currentMonthRow?.revenue ?? 0),
    vouchersSoldTotal: Number(totalRow?.total ?? 0),
    revenueTotal: Number(totalRow?.revenue ?? 0),
    lastSaleAt: lastSaleRow?.lastSaleAt ?? null,
  };
}

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
  const stats = await getPeriodStats(params.data.id);
  res.json(
    GetDistributorDailyStatsResponse.parse({
      distributorId: distributor.id,
      distributorName: distributor.name,
      ...stats,
    })
  );
});

router.post("/vendors/login", async (req, res): Promise<void> => {
  const parsed = VendorLoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { phone, pin } = parsed.data;
  const [distributor] = await db
    .select()
    .from(distributorsTable)
    .where(and(eq(distributorsTable.phone, phone), eq(distributorsTable.pin, pin)));
  if (!distributor) {
    res.status(401).json({ error: "Numéro de téléphone ou PIN incorrect" });
    return;
  }
  if (distributor.status !== "active") {
    res.status(401).json({ error: "Ce compte vendeur est inactif" });
    return;
  }
  res.json(
    VendorLoginResponse.parse({
      id: distributor.id,
      name: distributor.name,
      phone: distributor.phone ?? "",
      status: distributor.status,
    })
  );
});

router.get("/dashboard/distributors-daily", async (_req, res): Promise<void> => {
  const distributors = await db.select().from(distributorsTable);
  const result = await Promise.all(
    distributors.map(async (d) => {
      const stats = await getPeriodStats(d.id);
      return {
        distributorId: d.id,
        distributorName: d.name,
        phone: d.phone ?? null,
        status: d.status,
        ...stats,
      };
    })
  );
  result.sort((a, b) => b.revenueToday - a.revenueToday);
  res.json(GetDistributorsDailyReportResponse.parse(result));
});

export default router;
