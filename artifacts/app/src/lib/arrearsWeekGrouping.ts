/** Monday 00:00 UTC of the ISO calendar week containing `iso` (YYYY-MM-DD). */
export function mondayOfDateUtc(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

/** Sunday (end of week) for a week that starts on `monday` (YYYY-MM-DD), UTC. */
export function sundayFromMondayUtc(monday: string): string {
  const d = new Date(monday + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

/** Libellé « Arriéré semaine du … au … » avec formatage des dates (ex. fmtDateFr). */
export function weekArrearLabelWithFmt(weekMonday: string, fmtDate: (iso: string) => string): string {
  return `Arriéré semaine du ${fmtDate(weekMonday)} au ${fmtDate(sundayFromMondayUtc(weekMonday))}`;
}

/**
 * Retire les arriérés journaliers des semaines masquées (soldées) ou des semaines
 * antérieures à la dernière semaine soldée — même règle que GET /vendors/daily-arrears
 * (`maskedWeekMondays` = `settledWeeks[vendorId]`).
 */
export function filterDailyArrearsForMaskedWeeks<T extends { date: string }>(
  entries: T[],
  maskedWeekMondays?: string[] | null,
): T[] {
  if (!maskedWeekMondays?.length) return entries;
  const masked = new Set(maskedWeekMondays);
  let latest: string | null = null;
  for (const m of maskedWeekMondays) {
    if (!latest || m > latest) latest = m;
  }
  return entries.filter((e) => {
    const m = mondayOfDateUtc(e.date);
    if (masked.has(m)) return false;
    if (latest && m <= latest) return false;
    return true;
  });
}

/** Applique le masque semaine sur toutes les entrées d'une réponse daily-arrears. */
export function applyMaskedWeeksToDailyArrearsResponse<
  T extends { date: string },
  R extends { arrears: Record<string, T[]>; settledWeeks?: Record<string, string[]> },
>(resp: R | undefined): R | undefined {
  if (!resp?.arrears) return resp;
  const sw = resp.settledWeeks ?? {};
  const next: Record<string, T[]> = {};
  for (const [k, list] of Object.entries(resp.arrears)) {
    next[k] = filterDailyArrearsForMaskedWeeks(list, sw[k]);
  }
  return { ...resp, arrears: next };
}

export type DailyArrearEntryCore = {
  date: string;
  salesAmount: number;
  paidAmount: number;
  remaining: number;
  payments: { id: number; amount: number }[];
};

export type GroupedDailyArrearEntry = DailyArrearEntryCore & {
  __underlying?: DailyArrearEntryCore[];
  /** Monday YYYY-MM-DD of the calendar week for this row */
  __weekMonday: string;
};

/** One row per calendar week (Mon–Sun), ascending. */
export function groupArrearsByCalendarWeek(entries: DailyArrearEntryCore[]): GroupedDailyArrearEntry[] {
  const asc = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const byMonday = new Map<string, DailyArrearEntryCore[]>();
  for (const e of asc) {
    const m = mondayOfDateUtc(e.date);
    if (!byMonday.has(m)) byMonday.set(m, []);
    byMonday.get(m)!.push(e);
  }
  const out: GroupedDailyArrearEntry[] = [];
  for (const [monday, days] of [...byMonday.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (days.length === 1) {
      const d0 = days[0]!;
      out.push({ ...d0, __weekMonday: monday });
    } else {
      const last = days[days.length - 1]!;
      out.push({
        date: last.date,
        salesAmount: days.reduce((s, e) => s + e.salesAmount, 0),
        paidAmount: days.reduce((s, e) => s + e.paidAmount, 0),
        remaining: days.reduce((s, e) => s + e.remaining, 0),
        payments: days.flatMap((e) => e.payments),
        __underlying: days,
        __weekMonday: monday,
      });
    }
  }
  return out;
}

export type PortalArrearDayCore = {
  date: string;
  count: number;
  amount: number;
  paid: number;
  remaining: number;
};

export type GroupedPortalArrearDay = PortalArrearDayCore & {
  __underlying?: PortalArrearDayCore[];
  __weekMonday: string;
};

export function groupPortalArrearsByCalendarWeek(days: PortalArrearDayCore[]): GroupedPortalArrearDay[] {
  const asc = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const byMonday = new Map<string, PortalArrearDayCore[]>();
  for (const d of asc) {
    const m = mondayOfDateUtc(d.date);
    if (!byMonday.has(m)) byMonday.set(m, []);
    byMonday.get(m)!.push(d);
  }
  const out: GroupedPortalArrearDay[] = [];
  for (const [monday, ds] of [...byMonday.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (ds.length === 1) {
      const d0 = ds[0]!;
      out.push({ ...d0, __weekMonday: monday });
    } else {
      const last = ds[ds.length - 1]!;
      out.push({
        date: last.date,
        count: ds.reduce((s, d) => s + d.count, 0),
        amount: ds.reduce((s, d) => s + d.amount, 0),
        paid: ds.reduce((s, d) => s + d.paid, 0),
        remaining: ds.reduce((s, d) => s + d.remaining, 0),
        __underlying: ds,
        __weekMonday: monday,
      });
    }
  }
  return out;
}
