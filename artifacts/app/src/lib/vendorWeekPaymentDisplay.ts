/**
 * Net à reverser sur les ventes de la période (après commission) : ventes brutes − commission.
 */
export function weekNetDue(grossSales: number, commission: number | undefined): number {
  const g = Math.max(0, grossSales ?? 0);
  const c = Math.max(0, commission ?? 0);
  return Math.max(0, g - c);
}

/** Montant dû selon le mode de versement du vendeur. */
export function weekAmountDue(
  grossSales: number,
  commission: number | undefined,
  settlementMode?: string | null,
): number {
  if ((settlementMode ?? "daily") !== "weekly") {
    return Math.max(0, grossSales ?? 0);
  }
  return weekNetDue(grossSales, commission);
}

/**
 * Plafond d'affichage des versements sur la période :
 * - sans arriérés de semaines antérieures : min(versé, net période) ;
 * - avec arriérés : min(versé, net période + reliquat des semaines passées).
 */
export function paidShownVersusWeekContext(
  paid: number | undefined,
  grossSales: number,
  commission: number | undefined,
  carryOverFromPriorWeeks: number | undefined,
  settlementMode?: string | null,
): number {
  const p = Math.max(0, paid ?? 0);
  const net = weekAmountDue(grossSales, commission, settlementMode);
  const co = Math.max(0, carryOverFromPriorWeeks ?? 0);
  const cap = net + co;
  return Math.min(p, cap);
}

/**
 * Journalier + hebdo affichés sous le même plafond que `paidShownVersusWeekContext`.
 */
export function splitDailyWeeklyPaidShown(
  dailyPaid: number | undefined,
  weeklyPaid: number | undefined,
  grossSales: number,
  commission: number | undefined,
  carryOverFromPriorWeeks: number | undefined,
  settlementMode?: string | null,
): { daily: number; weekly: number } {
  const d = Math.max(0, dailyPaid ?? 0);
  const w = Math.max(0, weeklyPaid ?? 0);
  const cap =
    weekAmountDue(grossSales, commission, settlementMode) + Math.max(0, carryOverFromPriorWeeks ?? 0);
  const sum = d + w;
  if (sum <= cap) return { daily: d, weekly: w };
  if (sum === 0) return { daily: 0, weekly: 0 };
  const dailyShown = Math.floor((cap * d) / sum);
  return { daily: dailyShown, weekly: cap - dailyShown };
}
