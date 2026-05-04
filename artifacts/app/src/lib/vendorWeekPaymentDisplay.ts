/**
 * Net à reverser sur les ventes de la période (après commission) : brut − commission.
 */
export function weekNetDue(grossSales: number, commission: number | undefined): number {
  const g = Math.max(0, grossSales ?? 0);
  const c = Math.max(0, commission ?? 0);
  return Math.max(0, g - c);
}

/**
 * Plafond logique pour l’affichage des versements sur une semaine :
 *   (vendu − commission) + arriérés nets des semaines antérieures.
 * Au-delà, les enregistrements correspondent à d’autres contextes (erreur ou double compte).
 */
export function weekVersPaymentDisplayCap(
  grossSales: number,
  commission: number | undefined,
  carryOverAmount: number | undefined,
): number {
  return weekNetDue(grossSales, commission) + Math.max(0, carryOverAmount ?? 0);
}

/** Versements affichés, plafonnés au net semaine + arriérés antérieurs. */
export function paidShownVersusWeekContext(
  paid: number | undefined,
  grossSales: number,
  commission: number | undefined,
  carryOverAmount: number | undefined,
): number {
  const p = Math.max(0, paid ?? 0);
  return Math.min(p, weekVersPaymentDisplayCap(grossSales, commission, carryOverAmount));
}

/**
 * Journalier + hebdo : même plafond sur la somme, répartition au prorata si besoin.
 */
export function splitDailyWeeklyPaidShown(
  dailyPaid: number | undefined,
  weeklyPaid: number | undefined,
  grossSales: number,
  commission: number | undefined,
  carryOverAmount: number | undefined,
): { daily: number; weekly: number } {
  const d = Math.max(0, dailyPaid ?? 0);
  const w = Math.max(0, weeklyPaid ?? 0);
  const cap = weekVersPaymentDisplayCap(grossSales, commission, carryOverAmount);
  const sum = d + w;
  if (sum <= cap) return { daily: d, weekly: w };
  if (sum === 0) return { daily: 0, weekly: 0 };
  const dailyShown = Math.floor((cap * d) / sum);
  return { daily: dailyShown, weekly: cap - dailyShown };
}
