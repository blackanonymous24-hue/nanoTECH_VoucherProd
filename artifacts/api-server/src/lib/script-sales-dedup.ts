import { isoDayFromRawName, saleInMikhmonMonth, saleOnMikhmonIsoDay } from "./mikhmon-calendar.js";

/**
 * Clé logique d'une vente script — pour dédoublonner sans toucher à l'historique
 * (ventes dont le script a été purgé sur le MikroTik doivent rester en base).
 */
/** Heure script (champ 1 du rawName) — une vente = un script MikHmon. */
function mikhmonTimeFromRawName(rawName: string | null | undefined): string {
  if (!rawName?.trim()) return "";
  return rawName.split("-|-")[1]?.trim() || "00:00:00";
}

export function scriptSaleLogicalKey(
  username: string,
  saleDate: Date,
  price: string | null | undefined,
  ip: string | null | undefined,
  mac: string | null | undefined,
  rawName?: string | null,
): string {
  const u = username.trim().toLowerCase();
  const p = (price ?? "").trim();
  const day = isoDayFromRawName(rawName);
  if (day) {
    const t = mikhmonTimeFromRawName(rawName);
    const i = (ip ?? "").trim().toLowerCase();
    const m = (mac ?? "").trim().toLowerCase();
    return `${u}|${day}|${t}|${p}|${i}|${m}`;
  }
  const ts = saleDate instanceof Date ? saleDate.getTime() : new Date(saleDate).getTime();
  const sec = Number.isNaN(ts) ? 0 : Math.floor(ts / 1000);
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
  batch?: string | null;
  /** Date script MikHmon (champ 0 du rawName) — aligne le jour avec MikHmon. */
  rawName?: string | null;
};

/** Compte / somme avec dédoublonnage (une vente = une clé logique). */
export function aggregateScriptSalesDeduped(
  rows: ScriptSaleAggRow[],
  cal: {
    isoDateLabel: string;
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
    const key = scriptSaleLogicalKey(row.username, saleDate, row.price, row.ip, row.mac, row.rawName);
    const amount = parseAmount(row.price);

    if (saleOnMikhmonIsoDay(saleDate, cal.isoDateLabel, row.rawName)) {
      if (!seenDaily.has(key)) {
        seenDaily.add(key);
        dailyCount += 1;
        dailyAmount += amount;
      }
    }
    if (saleInMikhmonMonth(saleDate, cal, row.rawName)) {
      if (!seenMonthly.has(key)) {
        seenMonthly.add(key);
        monthlyCount += 1;
        monthlyAmount += amount;
      }
    }
  }

  return { dailyCount, dailyAmount, monthlyCount, monthlyAmount };
}
