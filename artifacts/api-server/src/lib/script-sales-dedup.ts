/**
 * Clé logique d'une vente script — pour dédoublonner sans toucher à l'historique
 * (ventes dont le script a été purgé sur le MikroTik doivent rester en base).
 */
export function scriptSaleLogicalKey(
  username: string,
  saleDate: Date,
  price: string | null | undefined,
  ip: string | null | undefined,
  mac: string | null | undefined,
): string {
  const u = username.trim().toLowerCase();
  const ts = saleDate instanceof Date ? saleDate.getTime() : new Date(saleDate).getTime();
  const sec = Number.isNaN(ts) ? 0 : Math.floor(ts / 1000);
  const p = (price ?? "").trim();
  const i = (ip ?? "").trim().toLowerCase();
  const m = (mac ?? "").trim().toLowerCase();
  return `${u}|${sec}|${p}|${i}|${m}`;
}

export type ScriptSaleAggRow = {
  username: string;
  saleDate: Date;
  price: string | null;
  ip?: string | null;
  mac?: string | null;
};

/** Compte / somme avec dédoublonnage (une vente = une clé logique). */
export function aggregateScriptSalesDeduped(
  rows: ScriptSaleAggRow[],
  cal: {
    todayMidnight: Date;
    tomorrowMidnight: Date;
    startOfMonth: Date;
    y: number;
    m: number;
  },
): {
  dailyCount: number;
  dailyAmount: number;
  monthlyCount: number;
  monthlyAmount: number;
} {
  const nextMonthStart = new Date(cal.y, cal.m, 1);
  const seenDaily = new Set<string>();
  const seenMonthly = new Set<string>();
  let dailyCount = 0;
  let dailyAmount = 0;
  let monthlyCount = 0;
  let monthlyAmount = 0;

  const parseAmount = (price: string | null | undefined): number => {
    if (!price?.trim()) return 0;
    return parseFloat(price.replace(/\s/g, "")) || 0;
  };

  for (const row of rows) {
    const saleDate = row.saleDate instanceof Date ? row.saleDate : new Date(row.saleDate);
    if (Number.isNaN(saleDate.getTime())) continue;
    const key = scriptSaleLogicalKey(row.username, saleDate, row.price, row.ip, row.mac);
    const ts = saleDate.getTime();
    const amount = parseAmount(row.price);

    if (ts >= cal.todayMidnight.getTime() && ts < cal.tomorrowMidnight.getTime()) {
      if (!seenDaily.has(key)) {
        seenDaily.add(key);
        dailyCount += 1;
        dailyAmount += amount;
      }
    }
    if (ts >= cal.startOfMonth.getTime() && ts < nextMonthStart.getTime()) {
      if (!seenMonthly.has(key)) {
        seenMonthly.add(key);
        monthlyCount += 1;
        monthlyAmount += amount;
      }
    }
  }

  return { dailyCount, dailyAmount, monthlyCount, monthlyAmount };
}
