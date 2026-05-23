import type { VendorPeriodAggRow } from "./vendor-period-sales-aggregate.js";

const TTL_MS = 45_000;
const cache = new Map<number, { rows: VendorPeriodAggRow[]; exp: number }>();

export function getVendorPeriodAggCached(routerId: number): VendorPeriodAggRow[] | null {
  const hit = cache.get(routerId);
  if (!hit || Date.now() >= hit.exp) return null;
  return hit.rows;
}

export function setVendorPeriodAggCached(routerId: number, rows: VendorPeriodAggRow[] | null): void {
  if (!rows) return;
  cache.set(routerId, { rows, exp: Date.now() + TTL_MS });
}

export function invalidateVendorPeriodAggCache(routerId: number): void {
  cache.delete(routerId);
}
