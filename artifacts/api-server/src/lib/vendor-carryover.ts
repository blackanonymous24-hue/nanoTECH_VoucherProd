import { and, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import { db, vouchersTable, vendorPaymentsTable, vendorDailyPaymentsTable } from "@workspace/db";

/**
 * Reliquat cumulé (net) des semaines calendaires strictement antérieures à
 * `beforeWeekMonday` — même règle que le suivi vendeur (daily-tracking).
 */
export async function carryOverByVendorBeforeWeek(
  routerId: number,
  beforeWeekMonday: string,
  vendorRows: { id: number; commissionRate: number | null; isDemo: boolean }[],
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const vendorIds = vendorRows.filter((v) => !v.isDemo).map((v) => v.id);
  if (vendorIds.length === 0) return out;
  const demoIds = new Set(vendorRows.filter((v) => v.isDemo).map((v) => v.id));
  const rateById = new Map(vendorRows.map((v) => [v.id, v.commissionRate ?? 0] as const));

  const [historicalSalesRaw, historicalWeeklyPaidRaw, historicalDailyPaidRaw] = await Promise.all([
    db.select({
      vendorId: vouchersTable.vendorId,
      weekStart: sql<string>`date_trunc('week', ${vouchersTable.usedAt})::date::text`,
      amount: sql<number>`coalesce(sum(coalesce(nullif(${vouchersTable.salePrice}, '')::numeric, nullif(${vouchersTable.price}, '')::numeric, 0)), 0)`,
    })
      .from(vouchersTable)
      .where(and(
        eq(vouchersTable.routerId, routerId),
        isNotNull(vouchersTable.usedAt),
        inArray(vouchersTable.vendorId, vendorIds),
        sql`date_trunc('week', ${vouchersTable.usedAt})::date::text < ${beforeWeekMonday}`,
      ))
      .groupBy(vouchersTable.vendorId, sql`date_trunc('week', ${vouchersTable.usedAt})::date::text`),
    db.select({
      vendorId: vendorPaymentsTable.vendorId,
      weekStart: vendorPaymentsTable.weekStart,
      amount: sql<number>`sum(${vendorPaymentsTable.amount})::int`,
    })
      .from(vendorPaymentsTable)
      .where(and(
        eq(vendorPaymentsTable.routerId, routerId),
        inArray(vendorPaymentsTable.vendorId, vendorIds),
        sql`${vendorPaymentsTable.weekStart} < ${beforeWeekMonday}`,
        gt(vendorPaymentsTable.amount, 0),
      ))
      .groupBy(vendorPaymentsTable.vendorId, vendorPaymentsTable.weekStart),
    db.select({
      vendorId: vendorDailyPaymentsTable.vendorId,
      weekStart: sql<string>`date_trunc('week', ${vendorDailyPaymentsTable.date}::date)::date::text`,
      amount: sql<number>`sum(${vendorDailyPaymentsTable.amount})::int`,
    })
      .from(vendorDailyPaymentsTable)
      .where(and(
        eq(vendorDailyPaymentsTable.routerId, routerId),
        inArray(vendorDailyPaymentsTable.vendorId, vendorIds),
        sql`${vendorDailyPaymentsTable.date} < ${beforeWeekMonday}`,
      ))
      .groupBy(vendorDailyPaymentsTable.vendorId, sql`date_trunc('week', ${vendorDailyPaymentsTable.date}::date)::date::text`),
  ]);

  const historicalPaidByVendorWeek = new Map<string, number>();
  for (const p of historicalWeeklyPaidRaw) {
    const k = `${p.vendorId}|${p.weekStart}`;
    historicalPaidByVendorWeek.set(k, (historicalPaidByVendorWeek.get(k) ?? 0) + Number(p.amount || 0));
  }
  for (const p of historicalDailyPaidRaw) {
    const k = `${p.vendorId}|${p.weekStart}`;
    historicalPaidByVendorWeek.set(k, (historicalPaidByVendorWeek.get(k) ?? 0) + Number(p.amount || 0));
  }

  for (const s of historicalSalesRaw) {
    if (!s.vendorId || demoIds.has(s.vendorId)) continue;
    const commRate = rateById.get(s.vendorId) ?? 0;
    const expected = Math.max(0, Number(s.amount || 0) - Math.round(Number(s.amount || 0) * commRate) / 100);
    const paid = historicalPaidByVendorWeek.get(`${s.vendorId}|${s.weekStart}`) ?? 0;
    const missing = Math.max(0, Math.round(expected - paid));
    if (missing > 0) {
      out.set(s.vendorId, (out.get(s.vendorId) ?? 0) + missing);
    }
  }
  return out;
}
