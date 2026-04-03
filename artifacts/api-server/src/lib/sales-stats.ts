import { eq, sql } from "drizzle-orm";
import { db, vouchersTable } from "@workspace/db";

/**
 * Returns per-profile period counts for a vendor.
 * Groups by profileName so amounts can be computed in JS
 * using the MikroTik profile price cache.
 */
export function buildProfilePeriodCounts(vendorId: number) {
  return db
    .select({
      profileName:   vouchersTable.profileName,
      todaySold:     sql<number>`count(*) filter (where ${vouchersTable.usedAt} >= current_date and ${vouchersTable.usedAt} < current_date + interval '1 day')`,
      yesterdaySold: sql<number>`count(*) filter (where ${vouchersTable.usedAt} >= current_date - interval '1 day' and ${vouchersTable.usedAt} < current_date)`,
      weekSold:      sql<number>`count(*) filter (where ${vouchersTable.usedAt} >= date_trunc('week', current_date) and ${vouchersTable.usedAt} < current_date + interval '1 day')`,
      lastMonthSold: sql<number>`count(*) filter (where ${vouchersTable.usedAt} >= date_trunc('month', current_date - interval '1 month') and ${vouchersTable.usedAt} < date_trunc('month', current_date))`,
      thisMonthSold: sql<number>`count(*) filter (where ${vouchersTable.usedAt} >= date_trunc('month', current_date) and ${vouchersTable.usedAt} < date_trunc('month', current_date) + interval '1 month')`,
      lastWeekSold:  sql<number>`count(*) filter (where ${vouchersTable.usedAt} >= date_trunc('week', current_date - interval '1 week') and ${vouchersTable.usedAt} < date_trunc('week', current_date))`,
    })
    .from(vouchersTable)
    .where(eq(vouchersTable.vendorId, vendorId))
    .groupBy(vouchersTable.profileName);
}

export type ProfilePeriodRow = Awaited<ReturnType<typeof buildProfilePeriodCounts>>[number];

/**
 * Computes sales stats (counts + amounts) from per-profile period counts
 * using the MikroTik profile price map as the authoritative price source.
 */
export function computeSalesStats(rows: ProfilePeriodRow[], priceMap: Map<string, string>) {
  let todaySold=0, todayAmount=0, yesterdaySold=0, yesterdayAmount=0;
  let weekSold=0, weekAmount=0, lastMonthSold=0, lastMonthAmount=0;
  let thisMonthSold=0, thisMonthAmount=0, lastWeekSold=0, lastWeekAmount=0;

  for (const r of rows) {
    const price = parseFloat((priceMap.get(r.profileName) ?? "0").replace(/[^0-9.]/g, "")) || 0;
    const ts  = Number(r.todaySold);     todaySold     += ts;  todayAmount     += ts  * price;
    const ys  = Number(r.yesterdaySold); yesterdaySold += ys;  yesterdayAmount += ys  * price;
    const ws  = Number(r.weekSold);      weekSold      += ws;  weekAmount      += ws  * price;
    const lms = Number(r.lastMonthSold); lastMonthSold += lms; lastMonthAmount += lms * price;
    const tms = Number(r.thisMonthSold); thisMonthSold += tms; thisMonthAmount += tms * price;
    const lws = Number(r.lastWeekSold);  lastWeekSold  += lws; lastWeekAmount  += lws * price;
  }
  return {
    todaySold, todayAmount, yesterdaySold, yesterdayAmount,
    weekSold, weekAmount, lastMonthSold, lastMonthAmount,
    thisMonthSold, thisMonthAmount, lastWeekSold, lastWeekAmount,
  };
}
