/**
 * Résumé rapide des rapports par routeur — une requête SQL groupée + cache ventes,
 * sans boucle N×MikroTik (affichage instantané page /reports).
 */
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { db, vendorsTable, vouchersTable } from "@workspace/db";
import { getRouterClockDateCached } from "./router-clock-cache.js";
import type { RouterConnection } from "./mikrotik.js";
import {
  aggregateVendorPeriodSales,
  UNATTRIBUTED_VENDOR_ID,
  UNATTRIBUTED_VENDOR_NAME,
} from "./vendor-period-sales-aggregate.js";
import { buildRouterVendorPeriodCounts } from "./sales-stats.js";

type VendorRow = typeof vendorsTable.$inferSelect;

const emptySalesStats = () => ({
  todaySold: 0,
  todayAmount: 0,
  yesterdaySold: 0,
  yesterdayAmount: 0,
  weekSold: 0,
  weekAmount: 0,
  lastWeekSold: 0,
  lastWeekAmount: 0,
  thisMonthSold: 0,
  thisMonthAmount: 0,
  lastMonthSold: 0,
  lastMonthAmount: 0,
});

function safeVendor(v: VendorRow) {
  const { passwordHash: _p, passwordPlain: _pp, ...rest } = v;
  return rest;
}

export async function buildRouterReportsSummaryFast(
  routerId: number,
  vendors: VendorRow[],
  conn?: RouterConnection | null,
): Promise<Array<{
  vendor: ReturnType<typeof safeVendor>;
  totalVouchers: number;
  totalPrinted: number;
  totalUsed: number;
  salesStats: ReturnType<typeof emptySalesStats>;
}>> {
  const reporting = vendors.filter((v) => !v.isDemo);
  const vendorIds = reporting.map((v) => v.id);
  if (vendorIds.length === 0) return [];

  const totalsRows = await db
    .select({
      vendorId: vouchersTable.vendorId,
      total: count(),
      printed: sql<number>`count(*) filter (where ${vouchersTable.printedAt} is not null)`,
      used: sql<number>`count(*) filter (where ${vouchersTable.usedAt} is not null)`,
    })
    .from(vouchersTable)
    .where(
      and(
        eq(vouchersTable.routerId, routerId),
        inArray(vouchersTable.vendorId, vendorIds),
      ),
    )
    .groupBy(vouchersTable.vendorId);

  const totalsByVendor = new Map(
    totalsRows.map((r) => [
      r.vendorId!,
      {
        total: Number(r.total ?? 0),
        printed: Number(r.printed ?? 0),
        used: Number(r.used ?? 0),
      },
    ]),
  );

  let clock: string | null = null;
  if (conn) {
    clock = await getRouterClockDateCached(routerId, conn);
  }
  const [aggRows, sqlByVendor] = await Promise.all([
    aggregateVendorPeriodSales(routerId, clock),
    buildRouterVendorPeriodCounts(routerId, vendorIds),
  ]);
  const aggByVendor = new Map((aggRows ?? []).map((r) => [r.vendorId, r]));

  const summaries = reporting.map((vendor) => {
    const t = totalsByVendor.get(vendor.id) ?? { total: 0, printed: 0, used: 0 };
    const agg = aggByVendor.get(vendor.id);
    const sqlPeriods = sqlByVendor.get(vendor.id);
    const salesStats = emptySalesStats();
    // today / thisMonth: prefer MikHmon-script aggregate (aligned with vendor portal),
    // fall back to SQL grouping when no script row.
    if (agg) {
      salesStats.todaySold = agg.dailySold;
      salesStats.todayAmount = agg.dailyAmount;
      salesStats.thisMonthSold = agg.monthlySold;
      salesStats.thisMonthAmount = agg.monthlyAmount;
    } else if (sqlPeriods) {
      salesStats.todaySold = sqlPeriods.todaySold;
      salesStats.todayAmount = sqlPeriods.todayAmount;
      salesStats.thisMonthSold = sqlPeriods.thisMonthSold;
      salesStats.thisMonthAmount = sqlPeriods.thisMonthAmount;
    }
    // yesterday / this week / last week / last month: only from SQL (script agg
    // doesn't expose these periods — historical zero values were a display bug).
    if (sqlPeriods) {
      salesStats.yesterdaySold = sqlPeriods.yesterdaySold;
      salesStats.yesterdayAmount = sqlPeriods.yesterdayAmount;
      salesStats.weekSold = sqlPeriods.weekSold;
      salesStats.weekAmount = sqlPeriods.weekAmount;
      salesStats.lastWeekSold = sqlPeriods.lastWeekSold;
      salesStats.lastWeekAmount = sqlPeriods.lastWeekAmount;
      salesStats.lastMonthSold = sqlPeriods.lastMonthSold;
      salesStats.lastMonthAmount = sqlPeriods.lastMonthAmount;
    }
    return {
      vendor: safeVendor(vendor),
      totalVouchers: t.total,
      totalPrinted: t.printed,
      totalUsed: t.used,
      salesStats,
    };
  });

  const unattr = aggByVendor.get(UNATTRIBUTED_VENDOR_ID);
  if (unattr && (unattr.dailySold > 0 || unattr.monthlySold > 0)) {
    summaries.push({
      vendor: {
        id: UNATTRIBUTED_VENDOR_ID,
        name: UNATTRIBUTED_VENDOR_NAME,
        phone: null,
        isActive: true,
      } as ReturnType<typeof safeVendor>,
      totalVouchers: 0,
      totalPrinted: 0,
      totalUsed: 0,
      salesStats: {
        ...emptySalesStats(),
        todaySold: unattr.dailySold,
        todayAmount: unattr.dailyAmount,
        thisMonthSold: unattr.monthlySold,
        thisMonthAmount: unattr.monthlyAmount,
      },
    });
  }

  return summaries;
}
