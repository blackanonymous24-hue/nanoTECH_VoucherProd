import type { SalesReport } from "./mikrotik.js";

export interface SalesCacheEntry {
  data: SalesReport;
  updatedAt: number;
}

const salesCache = new Map<string, SalesCacheEntry>();

export function purgeAllSalesRamCaches(): void {
  salesCache.clear();
}

export function getSalesCache(scope: string): SalesCacheEntry | undefined {
  return salesCache.get(scope);
}

export function setSalesCache(scope: string, entry: SalesCacheEntry): void {
  salesCache.set(scope, entry);
}

export function deleteSalesCache(scope: string): void {
  salesCache.delete(scope);
}
