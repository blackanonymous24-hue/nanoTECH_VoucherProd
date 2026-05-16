export type VendorSettlementMode = "daily" | "weekly";

export function normalizeSettlementMode(mode: unknown): VendorSettlementMode {
  return mode === "weekly" ? "weekly" : "daily";
}

export function isDailySettlementVendor(v: { settlementMode?: string | null }): boolean {
  return normalizeSettlementMode(v.settlementMode) === "daily";
}

/** Montant dû sur les ventes : brut si versement journalier, net (− commission) si hebdomadaire. */
export function amountDueFromSales(
  grossSales: number,
  commission: number,
  dailySettlement: boolean,
): number {
  const gross = Math.max(0, grossSales);
  const comm = Math.max(0, commission);
  return dailySettlement ? gross : Math.max(0, gross - comm);
}

export type DailySettlementCommission = {
  /** Somme des commissions journalières théoriques (ventes × taux). */
  gross: number;
  /** Rémunération affichée : chaque reliquat journalier est déduit du jour concerné. */
  net: number;
  reliquatTotal: number;
};

/**
 * Versement journalier : commission en temps réel sur la semaine,
 * diminuée jour par jour du reliquat (ventes du jour − versements du jour).
 */
export function dailySettlementWeekCommission(
  salesByDate: Map<string, number>,
  paidByDate: Map<string, number>,
  commissionRate: number,
): DailySettlementCommission {
  const rate = Math.max(0, Math.min(100, Math.round(commissionRate)));
  if (rate === 0) return { gross: 0, net: 0, reliquatTotal: 0 };

  let gross = 0;
  let net = 0;
  let reliquatTotal = 0;

  for (const [date, sales] of salesByDate) {
    if (sales <= 0) continue;
    const paid = Math.max(0, paidByDate.get(date) ?? 0);
    const dayComm = Math.round(sales * rate) / 100;
    const dayReliquat = Math.max(0, sales - paid);
    gross += dayComm;
    reliquatTotal += dayReliquat;
    net += Math.max(0, dayComm - dayReliquat);
  }

  return { gross, net, reliquatTotal };
}

export function mergeAmountIntoDateMap(
  target: Map<string, number>,
  date: string,
  amount: number,
): void {
  if (!date || amount <= 0) return;
  target.set(date, (target.get(date) ?? 0) + amount);
}

export function vendorDateAmountMaps(): {
  salesByVendor: Map<number, Map<string, number>>;
  paidByVendor: Map<number, Map<string, number>>;
} {
  return { salesByVendor: new Map(), paidByVendor: new Map() };
}

export function addVendorDateAmount(
  byVendor: Map<number, Map<string, number>>,
  vendorId: number,
  date: string,
  amount: number,
): void {
  if (!byVendor.has(vendorId)) byVendor.set(vendorId, new Map());
  mergeAmountIntoDateMap(byVendor.get(vendorId)!, date, amount);
}
