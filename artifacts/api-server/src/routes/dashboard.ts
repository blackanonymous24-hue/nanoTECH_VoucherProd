import { Router } from "express";
import { isNotNull, desc, gte, and, sql } from "drizzle-orm";
import { db, routersTable, vouchersTable } from "@workspace/db";

const router = Router();

router.get("/dashboard", async (_req, res): Promise<void> => {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    totalVouchers,
    routerCount,
    dailySalesResult,
    monthlySalesResult,
    recentVouchers,
  ] = await Promise.all([
    db.$count(vouchersTable),
    db.$count(routersTable),
    db
      .select({ count: sql<number>`cast(count(*) as int)`, total: sql<string>`coalesce(sum(nullif(regexp_replace(${vouchersTable.price}, '[^0-9.]', '', 'g'), '')::numeric), 0)::text` })
      .from(vouchersTable)
      .where(gte(vouchersTable.createdAt, startOfDay)),
    db
      .select({ count: sql<number>`cast(count(*) as int)`, total: sql<string>`coalesce(sum(nullif(regexp_replace(${vouchersTable.price}, '[^0-9.]', '', 'g'), '')::numeric), 0)::text` })
      .from(vouchersTable)
      .where(gte(vouchersTable.createdAt, startOfMonth)),
    db.select().from(vouchersTable).orderBy(desc(vouchersTable.createdAt)).limit(5),
  ]);

  const dailyCount = dailySalesResult[0]?.count ?? 0;
  const dailyAmount = parseFloat(dailySalesResult[0]?.total ?? "0") || 0;
  const monthlyCount = monthlySalesResult[0]?.count ?? 0;
  const monthlyAmount = parseFloat(monthlySalesResult[0]?.total ?? "0") || 0;

  res.json({
    totalVouchers,
    routerCount,
    dailySalesCount: dailyCount,
    dailySalesAmount: dailyAmount,
    monthlySalesCount: monthlyCount,
    monthlySalesAmount: monthlyAmount,
    recentVouchers,
  });
});

export default router;
