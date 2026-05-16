export type VendorSettlementMode = "daily" | "weekly";

export type VendorSettlementInfo = {
  settlementMode?: string | null;
  isDemo?: boolean | null;
};

export function isDailySettlementVendor(v: VendorSettlementInfo): boolean {
  if (v.isDemo) return false;
  return (v.settlementMode ?? "daily") === "daily";
}

export function hasDailySettlementVendors(
  vendors: VendorSettlementInfo[] | undefined,
): boolean {
  return !!vendors?.some(isDailySettlementVendor);
}
