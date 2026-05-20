import { and, eq, gte, isNotNull, lt, ne, sql } from "drizzle-orm";
import { db, vouchersTable } from "@workspace/db";

/** Bornes UTC : [startOfDay, end) — sargable, exploite l'index (router_id, used_at). */
function utcDayBounds(d: Date = new Date()): { start: Date; end: Date } {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
  const end   = new Date(start.getTime() + 86_400_000);
  return { start, end };
}
function utcMonthBounds(d: Date = new Date()): { start: Date; end: Date } {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
  const end   = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { start, end };
}

/**
 * Returns per-profile period counts AND actual salePrice sums for a vendor.
 *
 * Amounts use the real salePrice stored per-voucher (set by MikHMon script sync).
 * When salePrice is null (voucher not yet used or not synced), falls back to
 * the voucher's stored `price` field. This makes revenue correct even when
 * profileName doesn't match the MikroTik profile cache (e.g. historical
 * vouchers imported from scripts whose profileName is the human-readable label).
 *
 * @param routerId  When provided, restricts to vouchers from that router only
 *                  (avoids stale profiles from previous router assignments).
 */
export function buildProfilePeriodCounts(vendorId: number, routerId?: number | null) {
  const effectivePrice = sql<number>`coalesce(nullif(${vouchersTable.salePrice}, ''), nullif(${vouchersTable.price}, ''))::numeric`;

  const conditions = [
    eq(vouchersTable.vendorId, vendorId),
    ...(routerId != null ? [eq(vouchersTable.routerId, routerId)] : []),
  ];

  // Bornes calculées côté Node (UTC) — utilisent l'index B-tree (router_id, used_at).
  const now = new Date();
  const dayB   = utcDayBounds(now);
  const monthB = utcMonthBounds(now);
  const yesterdayB = utcDayBounds(new Date(dayB.start.getTime() - 86_400_000));

  const utcToday     = sql`${vouchersTable.usedAt} >= ${dayB.start}      AND ${vouchersTable.usedAt} < ${dayB.end}`;
  const utcYesterday = sql`${vouchersTable.usedAt} >= ${yesterdayB.start} AND ${vouchersTable.usedAt} < ${yesterdayB.end}`;
  const utcThisMonth = sql`${vouchersTable.usedAt} >= ${monthB.start}    AND ${vouchersTable.usedAt} < ${monthB.end}`;

  return db
    .select({
      profileName:       vouchersTable.profileName,
      todaySold:         sql<number>`count(*) filter (where ${utcToday})`,
      todayAmount:       sql<number>`coalesce(sum(${effectivePrice}) filter (where ${utcToday}), 0)`,
      yesterdaySold:     sql<number>`count(*) filter (where ${utcYesterday})`,
      yesterdayAmount:   sql<number>`coalesce(sum(${effectivePrice}) filter (where ${utcYesterday}), 0)`,
      weekSold:          sql<number>`count(*) filter (where ${vouchersTable.usedAt} >= date_trunc('week', current_date) and ${vouchersTable.usedAt} < current_date + interval '1 day')`,
      weekAmount:        sql<number>`coalesce(sum(${effectivePrice}) filter (where ${vouchersTable.usedAt} >= date_trunc('week', current_date) and ${vouchersTable.usedAt} < current_date + interval '1 day'), 0)`,
      lastWeekSold:      sql<number>`count(*) filter (where ${vouchersTable.usedAt} >= date_trunc('week', current_date - interval '1 week') and ${vouchersTable.usedAt} < date_trunc('week', current_date))`,
      lastWeekAmount:    sql<number>`coalesce(sum(${effectivePrice}) filter (where ${vouchersTable.usedAt} >= date_trunc('week', current_date - interval '1 week') and ${vouchersTable.usedAt} < date_trunc('week', current_date)), 0)`,
      thisMonthSold:     sql<number>`count(*) filter (where ${utcThisMonth})`,
      thisMonthAmount:   sql<number>`coalesce(sum(${effectivePrice}) filter (where ${utcThisMonth}), 0)`,
      lastMonthSold:     sql<number>`count(*) filter (where ${vouchersTable.usedAt} >= date_trunc('month', current_date - interval '1 month') and ${vouchersTable.usedAt} < date_trunc('month', current_date))`,
      lastMonthAmount:   sql<number>`coalesce(sum(${effectivePrice}) filter (where ${vouchersTable.usedAt} >= date_trunc('month', current_date - interval '1 month') and ${vouchersTable.usedAt} < date_trunc('month', current_date)), 0)`,
    })
    .from(vouchersTable)
    .where(and(...conditions))
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
    // priceMap price for this profile (from MikroTik cache) — used as a floor
    // so that tickets lacking sale_price/price in DB still contribute their
    // fair share to the total (matches the vendor-portal calculation method).
    const unitPrice = parseFloat((priceMap.get(r.profileName) ?? "0").replace(/[^0-9.]/g, "")) || 0;

    const ts  = Number(r.todaySold);     todaySold     += ts;
    const ys  = Number(r.yesterdaySold); yesterdaySold += ys;
    const ws  = Number(r.weekSold);      weekSold      += ws;
    const lws = Number(r.lastWeekSold);  lastWeekSold  += lws;
    const tms = Number(r.thisMonthSold); thisMonthSold += tms;
    const lms = Number(r.lastMonthSold); lastMonthSold += lms;

    // Take the MAXIMUM of:
    //   • SQL-aggregated actual amounts (sum of salePrice/price for vouchers that have it)
    //   • count × unitPrice (priceMap, covers vouchers without salePrice/price in DB)
    // This ensures partial coverage (some tickets have salePrice, others don't) is
    // handled correctly — the priceMap floor fills the gap for missing entries.
    todayAmount     += Math.max(Number(r.todayAmount),     ts  * unitPrice);
    yesterdayAmount += Math.max(Number(r.yesterdayAmount), ys  * unitPrice);
    weekAmount      += Math.max(Number(r.weekAmount),      ws  * unitPrice);
    lastWeekAmount  += Math.max(Number(r.lastWeekAmount),  lws * unitPrice);
    thisMonthAmount += Math.max(Number(r.thisMonthAmount), tms * unitPrice);
    lastMonthAmount += Math.max(Number(r.lastMonthAmount), lms * unitPrice);
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
