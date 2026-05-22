/**
 * Calendrier « jour / mois » aligné MikHmon : date du routeur (/system clock) si dispo,
 * sinon date locale du serveur (comme fetchSalesFromScripts).
 */
const MIKHMON_MONTH_ABBR = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export type MikhmonCalendar = {
  y: number;
  m: number;
  d: number;
  isoDateLabel: string;
  legacyDateLabel: string;
  isoOwner: string;
  todayMidnight: Date;
  tomorrowMidnight: Date;
  startOfMonth: Date;
};

/** Convertit une date script MikHmon (ISO ou legacy) en YYYY-MM-DD. */
export function toIsoDateStr(datePart: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
  const leg = datePart.match(/^([a-z]{3})\/(\d{1,2})\/(\d{4})$/i);
  if (leg) {
    const mIdx = MIKHMON_MONTH_ABBR.indexOf(leg[1].toLowerCase());
    if (mIdx >= 0) {
      return `${leg[3]}-${String(mIdx + 1).padStart(2, "0")}-${String(Number(leg[2])).padStart(2, "0")}`;
    }
  }
  return datePart;
}

/** Jour calendaire MikHmon extrait du rawName script (champ date avant -|-). */
export function isoDayFromRawName(rawName: string | null | undefined): string | null {
  if (!rawName?.trim()) return null;
  const datePart = rawName.split("-|-")[0]?.trim() ?? "";
  if (!datePart) return null;
  const iso = toIsoDateStr(datePart);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

/** true si la vente appartient au jour cal.isoDateLabel (comme le filtre jour MikHmon). */
export function saleOnMikhmonIsoDay(
  saleDate: Date,
  isoDateLabel: string,
  rawName?: string | null,
): boolean {
  const fromRaw = isoDayFromRawName(rawName);
  if (fromRaw) return fromRaw === isoDateLabel;
  const y = saleDate.getFullYear();
  const m = String(saleDate.getMonth() + 1).padStart(2, "0");
  const d = String(saleDate.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}` === isoDateLabel;
}

/** true si la vente appartient au mois calendaire MikHmon (champ date du script en priorité). */
export function saleInMikhmonMonth(
  saleDate: Date,
  cal: Pick<MikhmonCalendar, "y" | "m" | "startOfMonth">,
  rawName?: string | null,
): boolean {
  const fromRaw = isoDayFromRawName(rawName);
  if (fromRaw) {
    const [y, mo] = fromRaw.split("-").map(Number);
    return y === cal.y && mo === cal.m;
  }
  const ts = saleDate.getTime();
  if (Number.isNaN(ts)) return false;
  const nextMonthStart = new Date(cal.y, cal.m, 1).getTime();
  return ts >= cal.startOfMonth.getTime() && ts < nextMonthStart;
}

/** Parse la date RouterOS (jan/21/2026 ou 2026-05-21). */
export function parseRouterClockDate(clockDate: string | null | undefined): Date | null {
  if (!clockDate?.trim()) return null;
  const s = clockDate.trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  const leg = s.match(/^([a-z]{3})\/(\d{1,2})\/(\d{4})$/i);
  if (leg) {
    const mIdx = MIKHMON_MONTH_ABBR.indexOf(leg[1].toLowerCase());
    if (mIdx < 0) return null;
    const d = new Date(Number(leg[3]), mIdx, Number(leg[2]));
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Contexte jour/mois pour agrégats ventes (identique logique MikHmon live-report). */
export function getMikhmonCalendar(routerClockDate?: string | null): MikhmonCalendar {
  const routerDay = parseRouterClockDate(routerClockDate);
  const ref = routerDay ?? new Date();
  const y = ref.getFullYear();
  const m = ref.getMonth() + 1;
  const d = ref.getDate();
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  const todayMidnight = new Date(y, ref.getMonth(), d);
  const tomorrowMidnight = new Date(todayMidnight.getTime() + 86400_000);
  const startOfMonth = new Date(y, ref.getMonth(), 1);
  return {
    y,
    m,
    d,
    isoDateLabel: `${y}-${mm}-${dd}`,
    legacyDateLabel: `${MIKHMON_MONTH_ABBR[ref.getMonth()]}/${d}/${y}`,
    isoOwner: `${mm}${y}`,
    todayMidnight,
    tomorrowMidnight,
    startOfMonth,
  };
}

/** Bornes mois courant [début, début mois suivant) — même logique que readSalesQuickFromDb. */
export function mikhmonMonthRange(cal: MikhmonCalendar): { start: Date; end: Date } {
  return { start: cal.startOfMonth, end: new Date(cal.y, cal.m, 1) };
}

/** Bornes UTC pour un mois calendaire arbitraire (m = 1..12). */
export function mikhmonMonthRangeFor(year: number, month: number): { start: Date; end: Date } {
  return { start: new Date(year, month - 1, 1), end: new Date(year, month, 1) };
}

/** true si (year, month) est strictement avant le mois calendaire de référence. */
export function isCalendarMonthBefore(
  year: number,
  month: number,
  ref: Pick<MikhmonCalendar, "y" | "m">,
): boolean {
  return year < ref.y || (year === ref.y && month < ref.m);
}

export type MikhmonVendorPeriod = "today" | "yesterday" | "week" | "month";

/** Filtre période ventes (calendrier routeur / MikHmon), pas UTC serveur. */
export function saleInMikhmonPeriod(
  saleDate: Date,
  period: MikhmonVendorPeriod,
  cal: MikhmonCalendar,
  rawName?: string | null,
): boolean {
  const ts = saleDate.getTime();
  if (Number.isNaN(ts)) return false;
  if (period === "today") {
    return saleOnMikhmonIsoDay(saleDate, cal.isoDateLabel, rawName);
  }
  if (period === "yesterday") {
    const yest = new Date(cal.todayMidnight.getTime() - 86_400_000);
    const y = yest.getFullYear();
    const m = String(yest.getMonth() + 1).padStart(2, "0");
    const d = String(yest.getDate()).padStart(2, "0");
    return saleOnMikhmonIsoDay(saleDate, `${y}-${m}-${d}`, rawName);
  }
  if (period === "month") {
    return saleInMikhmonMonth(saleDate, cal, rawName);
  }
  const dayOfWeek = (cal.todayMidnight.getDay() + 6) % 7;
  const startOfWeek = new Date(cal.todayMidnight.getTime() - dayOfWeek * 86_400_000);
  const startOfLastWeek = new Date(startOfWeek.getTime() - 7 * 86_400_000);
  return ts >= startOfLastWeek.getTime() && ts < startOfWeek.getTime();
}
