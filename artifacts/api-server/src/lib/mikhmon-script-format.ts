/**
 * Formats scripts ventes MikHmon selon RouterOS :
 *   >= 7.10 (ISO)    : "2026-05-22-|-15:12:24-|-user-|-100-|-…"  owner="052026"
 *   <  7.10 (legacy) : "may/22/2026-|-15:12:24-|-user-|-500-|-…"  owner="may2026"
 *
 * Toute lecture de scripts (sync, live-report, détails) doit passer par ces helpers.
 */
export const MIKHMON_MONTH_ABBR = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
] as const;

/** Clés owner MikHmon pour un mois (ISO puis legacy). */
export function mikhmonOwnerVariants(year: number, month: number): {
  isoOwner: string;
  legacyOwner: string;
} {
  const mm = String(month).padStart(2, "0");
  const mIdx = month - 1;
  return {
    isoOwner: `${mm}${year}`,
    legacyOwner: `${MIKHMON_MONTH_ABBR[mIdx] ?? "jan"}${year}`,
  };
}

/** Ensemble owner pour les N derniers mois (2 formats × chaque mois). */
export function mikhmonOwnerSetForMonthsBack(monthsBack: number, ref: Date = new Date()): Set<string> {
  const ownerSet = new Set<string>();
  for (let i = 0; i <= monthsBack; i++) {
    const dt = new Date(ref.getFullYear(), ref.getMonth() - i, 1);
    const y = dt.getFullYear();
    const m = dt.getMonth() + 1;
    const { isoOwner, legacyOwner } = mikhmonOwnerVariants(y, m);
    ownerSet.add(isoOwner);
    ownerSet.add(legacyOwner);
  }
  return ownerSet;
}

/** Filtre jour MikHmon : ISO (suffixe -DD) et legacy (may/DD/yyyy). */
export function mikhmonScriptDateMatchesDay(rawDate: string, day: number): boolean {
  const dd = String(day).padStart(2, "0");
  const dNum = String(day);
  if (rawDate.endsWith(`-${dd}`)) return true;
  return new RegExp(`^[a-z]{3}\\/${dNum}\\/`, "i").test(rawDate);
}
