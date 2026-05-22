import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db, scriptSalesTable, scriptSalesMonthSyncTable } from "@workspace/db";
import {
  getMikhmonCalendar,
  isCalendarMonthBefore,
  mikhmonMonthRangeFor,
  type MikhmonCalendar,
} from "./mikhmon-calendar.js";
import { logger } from "./logger.js";

/** Crée la table de suivi si absente (idempotent). */
export async function ensureScriptSalesMonthSyncTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS mikrotik_script_sales_month_sync (
        id serial PRIMARY KEY,
        router_id integer NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
        year integer NOT NULL,
        month integer NOT NULL,
        last_sync_at timestamptz NOT NULL DEFAULT now(),
        verified_at timestamptz,
        script_count integer NOT NULL DEFAULT 0,
        CONSTRAINT uq_script_month_sync_router_ym UNIQUE (router_id, year, month)
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_script_month_sync_router
      ON mikrotik_script_sales_month_sync (router_id)
    `);
    logger.info("DB compat: table mikrotik_script_sales_month_sync vérifiée / ajoutée");
  } catch (err) {
    logger.error({ err }, "DB compat: impossible de créer mikrotik_script_sales_month_sync");
  }
}

export async function countScriptSalesInMonth(
  routerId: number,
  year: number,
  month: number,
): Promise<number> {
  const { start, end } = mikhmonMonthRangeFor(year, month);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(scriptSalesTable)
    .where(and(
      eq(scriptSalesTable.routerId, routerId),
      gte(scriptSalesTable.saleDate, start),
      lt(scriptSalesTable.saleDate, end),
    ));
  return Number(row?.n ?? 0);
}

export async function getMonthSyncRow(
  routerId: number,
  year: number,
  month: number,
): Promise<typeof scriptSalesMonthSyncTable.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(scriptSalesMonthSyncTable)
    .where(and(
      eq(scriptSalesMonthSyncTable.routerId, routerId),
      eq(scriptSalesMonthSyncTable.year, year),
      eq(scriptSalesMonthSyncTable.month, month),
    ))
    .limit(1);
  return row ?? null;
}

/** Mois passé déjà sync + vérifié → pas de nouveau pull MikroTik pour ce mois. */
export async function isPastMonthVerified(
  routerId: number,
  year: number,
  month: number,
  cal: MikhmonCalendar,
): Promise<boolean> {
  if (!isCalendarMonthBefore(year, month, cal)) return false;
  const row = await getMonthSyncRow(routerId, year, month);
  return row?.verifiedAt != null;
}

export async function upsertMonthSyncRecord(
  routerId: number,
  year: number,
  month: number,
  scriptCount: number,
  opts: { verified?: boolean },
): Promise<void> {
  const now = new Date();
  const verifiedAt = opts.verified ? now : null;
  await db
    .insert(scriptSalesMonthSyncTable)
    .values({
      routerId,
      year,
      month,
      lastSyncAt: now,
      verifiedAt,
      scriptCount,
    })
    .onConflictDoUpdate({
      target: [
        scriptSalesMonthSyncTable.routerId,
        scriptSalesMonthSyncTable.year,
        scriptSalesMonthSyncTable.month,
      ],
      set: {
        lastSyncAt: now,
        scriptCount,
        ...(opts.verified ? { verifiedAt: now } : {}),
      },
    });
}

/** Marque le mois précédent comme vérifié quand le calendrier routeur avance. */
export async function closePreviousMonthIfNeeded(
  routerId: number,
  cal: MikhmonCalendar,
): Promise<void> {
  const prev = new Date(cal.y, cal.m - 2, 1);
  const py = prev.getFullYear();
  const pm = prev.getMonth() + 1;
  const row = await getMonthSyncRow(routerId, py, pm);
  if (row?.verifiedAt) return;
  const cnt = await countScriptSalesInMonth(routerId, py, pm);
  if (cnt === 0 && !row) return;
  await upsertMonthSyncRecord(routerId, py, pm, cnt, { verified: true });
}

/**
 * Mois passés déjà présents en base mais sans marqueur (après restart / migration) :
 * dédoublonnage local puis marquage « vérifié » sans pull MikroTik.
 */
export async function bootstrapVerifiedMonthsFromDb(
  routerId: number,
  cal?: MikhmonCalendar,
): Promise<number> {
  const ref = cal ?? getMikhmonCalendar(null);
  const rows = await db
    .select({
      year: sql<number>`extract(year from ${scriptSalesTable.saleDate})::int`,
      month: sql<number>`extract(month from ${scriptSalesTable.saleDate})::int`,
      cnt: sql<number>`count(*)::int`,
    })
    .from(scriptSalesTable)
    .where(eq(scriptSalesTable.routerId, routerId))
    .groupBy(
      sql`extract(year from ${scriptSalesTable.saleDate})`,
      sql`extract(month from ${scriptSalesTable.saleDate})`,
    );

  let marked = 0;
  for (const r of rows) {
    const y = Number(r.year);
    const m = Number(r.month);
    const cnt = Number(r.cnt);
    if (!y || !m || cnt <= 0) continue;
    if (!isCalendarMonthBefore(y, m, ref)) continue;
    if (await isPastMonthVerified(routerId, y, m, ref)) continue;
    await upsertMonthSyncRecord(routerId, y, m, cnt, { verified: true });
    marked++;
  }
  if (marked > 0) {
    logger.info({ routerId, marked }, "script month sync: mois passés marqués vérifiés depuis la base");
  }
  return marked;
}

export async function clearRouterMonthSyncMarkers(routerId: number): Promise<void> {
  await db
    .delete(scriptSalesMonthSyncTable)
    .where(eq(scriptSalesMonthSyncTable.routerId, routerId));
}
