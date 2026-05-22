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
        mikrotik_sync_at timestamptz,
        verified_at timestamptz,
        script_count integer NOT NULL DEFAULT 0,
        CONSTRAINT uq_script_month_sync_router_ym UNIQUE (router_id, year, month)
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_script_month_sync_router
      ON mikrotik_script_sales_month_sync (router_id)
    `);
    await db.execute(sql`
      ALTER TABLE mikrotik_script_sales_month_sync
      ADD COLUMN IF NOT EXISTS mikrotik_sync_at timestamptz
    `);
    await db.execute(sql`
      UPDATE mikrotik_script_sales_month_sync
      SET verified_at = NULL
      WHERE verified_at IS NOT NULL AND mikrotik_sync_at IS NULL
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
  opts: { verified?: boolean; mikrotikSync?: boolean },
): Promise<void> {
  const now = new Date();
  const existing = await getMonthSyncRow(routerId, year, month);
  const mikrotikSyncAt =
    opts.mikrotikSync ? now : (existing?.mikrotikSyncAt ?? null);
  const canVerify = !!(mikrotikSyncAt);
  const verifiedAt = opts.verified && canVerify ? now : (existing?.verifiedAt ?? null);

  if (opts.verified && !canVerify) {
    logger.warn(
      { routerId, year, month },
      "script month sync: refus marquage vérifié sans pull MikroTik préalable",
    );
  }

  await db
    .insert(scriptSalesMonthSyncTable)
    .values({
      routerId,
      year,
      month,
      lastSyncAt: now,
      mikrotikSyncAt,
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
        ...(opts.mikrotikSync ? { mikrotikSyncAt: now } : {}),
        ...(opts.verified && canVerify ? { verifiedAt: now } : {}),
      },
    });
}

/** true si ce mois a déjà été rapatrié depuis le MikroTik au moins une fois. */
export async function monthHadMikrotikSync(
  routerId: number,
  year: number,
  month: number,
): Promise<boolean> {
  const row = await getMonthSyncRow(routerId, year, month);
  return row?.mikrotikSyncAt != null;
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
  await upsertMonthSyncRecord(routerId, py, pm, cnt, {
    verified: true,
    mikrotikSync: row?.mikrotikSyncAt != null,
  });
}

export async function clearRouterMonthSyncMarkers(routerId: number): Promise<void> {
  await db
    .delete(scriptSalesMonthSyncTable)
    .where(eq(scriptSalesMonthSyncTable.routerId, routerId));
}
