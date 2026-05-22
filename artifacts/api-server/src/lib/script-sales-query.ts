/**
 * Chargement ventes script pour agrégats — calendrier MikHmon (date dans rawName en priorité).
 * Évite de rater des ventes dont sale_date DB est incorrect (ex. fallback `new Date()` à l'insert).
 */
import { and, eq, gte, lt } from "drizzle-orm";
import { db, scriptSalesTable } from "@workspace/db";
import { logger } from "./logger.js";
import {
  getMikhmonCalendar,
  mikhmonMonthRange,
  saleInMikhmonMonth,
  type MikhmonCalendar,
} from "./mikhmon-calendar.js";
import { parseMikhmonDate } from "./mikrotik.js";
import type { ScriptSaleAggRow } from "./script-sales-dedup.js";

/** Date/heure de vente extraite du nom de script MikHmon (champs 0 et 1). */
export function saleDateFromRawName(rawName: string | null | undefined): Date | null {
  if (!rawName?.trim()) return null;
  const parts = rawName.split("-|-");
  const datePart = parts[0]?.trim() ?? "";
  const timePart = parts[1]?.trim() ?? "";
  if (!datePart) return null;
  return parseMikhmonDate(datePart, timePart || "00:00:00");
}

/** Date effective pour agrégats : rawName d'abord, sinon colonne sale_date. */
export function effectiveSaleDate(saleDate: Date, rawName?: string | null): Date {
  const fromRaw = saleDateFromRawName(rawName);
  if (fromRaw && !Number.isNaN(fromRaw.getTime())) return fromRaw;
  return saleDate instanceof Date ? saleDate : new Date(saleDate);
}

const LOOKBACK_DAYS = 45;

export type ScriptSalesMonthLoad = {
  cal: MikhmonCalendar;
  rows: ScriptSaleAggRow[];
};

/**
 * Lignes du mois calendaire MikHmon (comme owner=mmYYYY + filtre date script côté MikHmon).
 * Fenêtre SQL élargie pour inclure les lignes dont sale_date est décalée mais rawName est dans le mois.
 */
export async function loadScriptSalesAggRowsForMikhmonMonth(
  routerId: number,
  routerClockDate?: string | null,
): Promise<ScriptSalesMonthLoad> {
  const cal = getMikhmonCalendar(routerClockDate);
  const { start: monthStart, end: monthEnd } = mikhmonMonthRange(cal);
  const lookbackStart = new Date(monthStart.getTime() - LOOKBACK_DAYS * 86_400_000);

  const rawRows = await db
    .select({
      username: scriptSalesTable.username,
      saleDate: scriptSalesTable.saleDate,
      price: scriptSalesTable.price,
      ip: scriptSalesTable.ip,
      mac: scriptSalesTable.mac,
      batch: scriptSalesTable.batch,
      rawName: scriptSalesTable.rawName,
    })
    .from(scriptSalesTable)
    .where(
      and(
        eq(scriptSalesTable.routerId, routerId),
        gte(scriptSalesTable.saleDate, lookbackStart),
        lt(scriptSalesTable.saleDate, monthEnd),
      ),
    );

  const rows: ScriptSaleAggRow[] = [];
  for (const row of rawRows) {
    const base = row.saleDate instanceof Date ? row.saleDate : new Date(row.saleDate);
    if (Number.isNaN(base.getTime())) continue;
    const saleDate = effectiveSaleDate(base, row.rawName);
    if (!saleInMikhmonMonth(saleDate, cal, row.rawName)) continue;
    rows.push({
      username: row.username,
      saleDate,
      price: row.price,
      ip: row.ip,
      mac: row.mac,
      batch: row.batch,
      rawName: row.rawName,
    });
  }

  return { cal, rows };
}

/** Lignes d'un mois calendaire arbitraire (backfill / compteurs sync). */
export async function loadScriptSalesAggRowsForYearMonth(
  routerId: number,
  year: number,
  month: number,
): Promise<ScriptSaleAggRow[]> {
  const startOfMonth = new Date(year, month - 1, 1);
  const cal = {
    y: year,
    m: month,
    startOfMonth,
    isoDateLabel: "",
    todayMidnight: startOfMonth,
    tomorrowMidnight: new Date(year, month, 1),
  } as MikhmonCalendar;
  const { start: monthStart, end: monthEnd } = mikhmonMonthRange(cal);
  const lookbackStart = new Date(monthStart.getTime() - LOOKBACK_DAYS * 86_400_000);

  const rawRows = await db
    .select({
      username: scriptSalesTable.username,
      saleDate: scriptSalesTable.saleDate,
      price: scriptSalesTable.price,
      ip: scriptSalesTable.ip,
      mac: scriptSalesTable.mac,
      batch: scriptSalesTable.batch,
      rawName: scriptSalesTable.rawName,
    })
    .from(scriptSalesTable)
    .where(
      and(
        eq(scriptSalesTable.routerId, routerId),
        gte(scriptSalesTable.saleDate, lookbackStart),
        lt(scriptSalesTable.saleDate, monthEnd),
      ),
    );

  const rows: ScriptSaleAggRow[] = [];
  for (const row of rawRows) {
    const base = row.saleDate instanceof Date ? row.saleDate : new Date(row.saleDate);
    if (Number.isNaN(base.getTime())) continue;
    const saleDate = effectiveSaleDate(base, row.rawName);
    if (!saleInMikhmonMonth(saleDate, cal, row.rawName)) continue;
    rows.push({
      username: row.username,
      saleDate,
      price: row.price,
      ip: row.ip,
      mac: row.mac,
      batch: row.batch,
      rawName: row.rawName,
    });
  }
  return rows;
}

/**
 * Corrige sale_date en base quand elle ne correspond pas à la date du script (rawName).
 * Utile après des insertions avec fallback `new Date()`.
 */
export async function reconcileSaleDatesFromRawName(
  routerId: number,
  monthStart: Date,
  monthEnd: Date,
): Promise<number> {
  const lookbackStart = new Date(monthStart.getTime() - LOOKBACK_DAYS * 86_400_000);
  const rows = await db
    .select({
      id: scriptSalesTable.id,
      saleDate: scriptSalesTable.saleDate,
      rawName: scriptSalesTable.rawName,
    })
    .from(scriptSalesTable)
    .where(
      and(
        eq(scriptSalesTable.routerId, routerId),
        gte(scriptSalesTable.saleDate, lookbackStart),
        lt(scriptSalesTable.saleDate, monthEnd),
      ),
    );

  let updated = 0;
  for (const row of rows) {
    const fromRaw = saleDateFromRawName(row.rawName);
    if (!fromRaw || Number.isNaN(fromRaw.getTime())) continue;
    const current = row.saleDate instanceof Date ? row.saleDate : new Date(row.saleDate);
    if (Number.isNaN(current.getTime())) continue;
    if (Math.abs(fromRaw.getTime() - current.getTime()) < 60_000) continue;
    await db
      .update(scriptSalesTable)
      .set({ saleDate: fromRaw })
      .where(eq(scriptSalesTable.id, row.id));
    updated += 1;
  }
  if (updated > 0) {
    logger.info({ routerId, updated }, "script sales: sale_date réalignée depuis rawName");
  }
  return updated;
}
