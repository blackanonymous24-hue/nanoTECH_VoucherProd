import { eq, sql } from "drizzle-orm";
import { db, vouchersTable } from "@workspace/db";

/**
 * Returns per-profile period counts AND actual salePrice sums for a vendor.
 *
 * Amounts use the real salePrice stored per-voucher (set by MikHMon script sync).
 * When salePrice is null (voucher not yet used or not synced), falls back to
 * the voucher's stored `price` field. This makes revenue correct even when
 * profileName doesn't match the MikroTik profile cache (e.g. historical
 * vouchers imported from scripts whose profileName is the human-readable label).
 */
export function buildProfilePeriodCounts(vendorId: number) {
  const effectivePrice = sql<number>`coalesce(nullif(${vouchersTable.salePrice}, ''), nullif(${vouchersTable.price}, ''))::numeric`;

  return db
    .select({
      profileName:       vouchersTable.profileName,
      todaySold:         sql<number>`count(*) filter (where ${vouchersTable.usedAt} >= current_date and ${vouchersTable.usedAt} < current_date + interval '1 day')`,
      todayAmount:       sql<number>`coalesce(sum(${effectivePrice}) filter (where ${vouchersTable.usedAt} >= current_date and ${vouchersTable.usedAt} < current_date + interval '1 day'), 0)`,
      yesterdaySold:     sql<number>`count(*) filter (where ${vouchersTable.usedAt} >= current_date - interval '1 day' and ${vouchersTable.usedAt} < current_date)`,
      yesterdayAmount:   sql<number>`coalesce(sum(${effectivePrice}) filter (where ${vouchersTable.usedAt} >= current_date - interval '1 day' and ${vouchersTable.usedAt} < current_date), 0)`,
      weekSold:          sql<number>`count(*) filter (where ${vouchersTable.usedAt} >= date_trunc('week', current_date) and ${vouchersTable.usedAt} < current_date + interval '1 day')`,
      weekAmount:        sql<number>`coalesce(sum(${effectivePrice}) filter (where ${vouchersTable.usedAt} >= date_trunc('week', current_date) and ${vouchersTable.usedAt} < current_date + interval '1 day'), 0)`,
      lastWeekSold:      sql<number>`count(*) filter (where ${vouchersTable.usedAt} >= date_trunc('week', current_date - interval '1 week') and ${vouchersTable.usedAt} < date_trunc('week', current_date))`,
      lastWeekAmount:    sql<number>`coalesce(sum(${effectivePrice}) filter (where ${vouchersTable.usedAt} >= date_trunc('week', current_date - interval '1 week') and ${vouchersTable.usedAt} < date_trunc('week', current_date)), 0)`,
      thisMonthSold:     sql<number>`count(*) filter (where ${vouchersTable.usedAt} >= date_trunc('month', current_date) and ${vouchersTable.usedAt} < date_trunc('month', current_date) + interval '1 month')`,
      thisMonthAmount:   sql<number>`coalesce(sum(${effectivePrice}) filter (where ${vouchersTable.usedAt} >= date_trunc('month', current_date) and ${vouchersTable.usedAt} < date_trunc('month', current_date) + interval '1 month'), 0)`,
      lastMonthSold:     sql<number>`count(*) filter (where ${vouchersTable.usedAt} >= date_trunc('month', current_date - interval '1 month') and ${vouchersTable.usedAt} < date_trunc('month', current_date))`,
      lastMonthAmount:   sql<number>`coalesce(sum(${effectivePrice}) filter (where ${vouchersTable.usedAt} >= date_trunc('month', current_date - interval '1 month') and ${vouchersTable.usedAt} < date_trunc('month', current_date)), 0)`,
    })
    .from(vouchersTable)
    .where(eq(vouchersTable.vendorId, vendorId))
    .groupBy(vouchersTable.profileName);
}

export type ProfilePeriodRow = Awaited<ReturnType<typeof buildProfilePeriodCounts>>[number];

/**
 * Aggregates period stats across all profiles.
 *
 * Amounts now come directly from SQL-summed salePrice/price columns — the
 * priceMap is only used as a last-resort fallback for vouchers with neither
 * salePrice nor price set.
 */
export function computeSalesStats(rows: ProfilePeriodRow[], priceMap: Map<string, string>) {
  let todaySold = 0,     todayAmount = 0;
  let yesterdaySold = 0, yesterdayAmount = 0;
  let weekSold = 0,      weekAmount = 0;
  let lastWeekSold = 0,  lastWeekAmount = 0;
  let thisMonthSold = 0, thisMonthAmount = 0;
  let lastMonthSold = 0, lastMonthAmount = 0;

  for (const r of rows) {
    // Fall-back price only when the DB has no price at all on these vouchers
    const fallback = parseFloat((priceMap.get(r.profileName) ?? "0").replace(/[^0-9.]/g, "")) || 0;

    const ts  = Number(r.todaySold);     todaySold     += ts;
    const ys  = Number(r.yesterdaySold); yesterdaySold += ys;
    const ws  = Number(r.weekSold);      weekSold      += ws;
    const lws = Number(r.lastWeekSold);  lastWeekSold  += lws;
    const tms = Number(r.thisMonthSold); thisMonthSold += tms;
    const lms = Number(r.lastMonthSold); lastMonthSold += lms;

    // Use SQL-aggregated actual amounts; fall back to count×price only when amount = 0
    todayAmount     += Number(r.todayAmount)     || ts  * fallback;
    yesterdayAmount += Number(r.yesterdayAmount) || ys  * fallback;
    weekAmount      += Number(r.weekAmount)      || ws  * fallback;
    lastWeekAmount  += Number(r.lastWeekAmount)  || lws * fallback;
    thisMonthAmount += Number(r.thisMonthAmount) || tms * fallback;
    lastMonthAmount += Number(r.lastMonthAmount) || lms * fallback;
  }

  return {
    todaySold, todayAmount,
    yesterdaySold, yesterdayAmount,
    weekSold, weekAmount,
    lastWeekSold, lastWeekAmount,
    thisMonthSold, thisMonthAmount,
    lastMonthSold, lastMonthAmount,
  };
}
