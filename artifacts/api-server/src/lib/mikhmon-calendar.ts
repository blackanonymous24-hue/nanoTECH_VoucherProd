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

export type MikhmonVendorPeriod = "today" | "yesterday" | "week" | "month";

/** Filtre période ventes (calendrier routeur / MikHmon), pas UTC serveur. */
export function saleInMikhmonPeriod(
  saleDate: Date,
  period: MikhmonVendorPeriod,
  cal: MikhmonCalendar,
): boolean {
  const ts = saleDate.getTime();
  if (Number.isNaN(ts)) return false;
  if (period === "today") {
    return ts >= cal.todayMidnight.getTime() && ts < cal.tomorrowMidnight.getTime();
  }
  if (period === "yesterday") {
    const yestStart = cal.todayMidnight.getTime() - 86_400_000;
    return ts >= yestStart && ts < cal.todayMidnight.getTime();
  }
  if (period === "month") {
    const { start, end } = mikhmonMonthRange(cal);
    return ts >= start.getTime() && ts < end.getTime();
  }
  const dayOfWeek = (cal.todayMidnight.getDay() + 6) % 7;
  const startOfWeek = new Date(cal.todayMidnight.getTime() - dayOfWeek * 86_400_000);
  const startOfLastWeek = new Date(startOfWeek.getTime() - 7 * 86_400_000);
  return ts >= startOfLastWeek.getTime() && ts < startOfWeek.getTime();
}
