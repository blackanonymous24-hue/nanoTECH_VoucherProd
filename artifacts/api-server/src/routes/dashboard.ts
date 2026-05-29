import { Router } from "express";
import { desc, gte, and, sql, inArray, eq } from "drizzle-orm";
import { db, routersTable, vouchersTable } from "@workspace/db";
import { resolveCallerScope } from "./routers.js";

const router = Router();

router.get("/dashboard", async (req, res): Promise<void> => {
  const scope = await resolveCallerScope(req);
  if (!scope) { res.status(401).json({ error: "Non authentifié" }); return; }
  if (scope.kind === "vendor") {
    res.status(403).json({ error: "Accès refusé" });
    return;
  }

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  let routerIds: number[] | null = null;
  if (scope.kind === "manager" || scope.kind === "collaborateur") {
    routerIds = scope.routerIds;
    if (routerIds.length === 0) {
      res.json({
        totalVouchers: 0,
        routerCount: 0,
        dailySalesCount: 0,
        dailySalesAmount: 0,
        monthlySalesCount: 0,
        monthlySalesAmount: 0,
        recentVouchers: [],
      });
      return;
    }
  } else if (scope.kind === "admin" || scope.kind === "super") {
    const rows = await db
      .select({ id: routersTable.id })
      .from(routersTable)
      .where(eq(routersTable.ownerAdminId, scope.adminId));
    routerIds = rows.map((r) => r.id);
  }

  const routerFilter = routerIds && routerIds.length > 0
    ? inArray(vouchersTable.routerId, routerIds)
    : undefined;

  const [
    totalVouchers,
    routerCount,
    dailySalesResult,
    monthlySalesResult,
    recentVouchers,
  ] = await Promise.all([
    routerFilter
      ? db.$count(vouchersTable, routerFilter)
      : db.$count(vouchersTable),
    routerIds
      ? routerIds.length
      : db.$count(routersTable),
    db
      .select({ count: sql<number>`cast(count(*) as int)`, total: sql<string>`coalesce(sum(nullif(regexp_replace(${vouchersTable.price}, '[^0-9.]', '', 'g'), '')::numeric), 0)::text` })
      .from(vouchersTable)
      .where(and(gte(vouchersTable.createdAt, startOfDay), routerFilter)),
    db
      .select({ count: sql<number>`cast(count(*) as int)`, total: sql<string>`coalesce(sum(nullif(regexp_replace(${vouchersTable.price}, '[^0-9.]', '', 'g'), '')::numeric), 0)::text` })
      .from(vouchersTable)
      .where(and(gte(vouchersTable.createdAt, startOfMonth), routerFilter)),
    db
      .select()
      .from(vouchersTable)
      .where(routerFilter)
      .orderBy(desc(vouchersTable.createdAt))
      .limit(5),
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
