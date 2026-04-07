/**
 * Script Cache — local mirror of MikHMon sales script entries.
 *
 * Instead of querying MikroTik for thousands of scripts on every sync,
 * this module:
 *   1. On first run → fetches ALL scripts (?comment=mikhmon) and persists them
 *   2. On subsequent runs → fetches only current + previous month and upserts
 *   3. Provides fast DB-backed lookups for sale details and batch matching
 *
 * This eliminates the heavy ?comment=mikhmon call from the hot sync path and
 * relieves the MikroTik CPU significantly.
 */
import { eq, and, sql } from "drizzle-orm";
import { db, scriptSalesTable, routersTable } from "@workspace/db";
import { fetchScriptSales, type RouterConnection } from "./mikrotik.js";
import { logger } from "./logger.js";

/** Shape returned by getCachedSaleDetails — mirrors mikrotik.ts SaleDetail */
export interface CachedSaleDetail {
  saleDate:  Date;
  salePrice: string | null;
  ip:        string;
  mac:       string;
}

/** In-memory flag: routers whose cache has been fully populated this process lifetime */
const fullyPopulated = new Set<number>();

/**
 * Synchronise the local script cache for a router.
 *
 * - First run (cache empty) → fetch ALL scripts (one heavy call, one time)
 * - Subsequent runs → fetch only this month + last month (lightweight)
 *
 * Returns the number of new rows inserted.
 */
export async function syncScriptCache(
  routerId: number,
  conn: RouterConnection,
): Promise<number> {
  try {
    // Check if we already have data for this router
    const [countRow] = await db
      .select({ n: sql<number>`count(*)` })
      .from(scriptSalesTable)
      .where(eq(scriptSalesTable.routerId, routerId));

    const isEmpty = Number(countRow?.n ?? 0) === 0;
    const needsFullLoad = isEmpty || !fullyPopulated.has(routerId);

    let entries: Awaited<ReturnType<typeof fetchScriptSales>>;

    if (needsFullLoad) {
      // Full load: all historical scripts — heavy but done only once
      logger.info({ routerId }, "script cache: full load started (first run)");
      entries = await fetchScriptSales(conn, { type: "all" }, 120_000);
      fullyPopulated.add(routerId);
    } else {
      // Incremental: fetch this month + last month only
      const now = new Date();
      const thisYear  = now.getFullYear();
      const thisMonth = now.getMonth() + 1; // 1-12
      const lastYear  = thisMonth === 1 ? thisYear - 1 : thisYear;
      const lastMonth = thisMonth === 1 ? 12 : thisMonth - 1;

      const [a, b] = await Promise.all([
        fetchScriptSales(conn, { type: "month", year: thisYear,  month: thisMonth }, 30_000),
        fetchScriptSales(conn, { type: "month", year: lastYear,  month: lastMonth }, 30_000),
      ]);
      entries = [...a, ...b];
    }

    if (entries.length === 0) return 0;

    // Build rows — rawName encodes all fields and is the unique key per router
    const rows = entries.map((e) => {
      const raw = [e.date, e.time, e.username, e.price, e.ip, e.mac, e.validity, e.label, e.batch].join("-|-");
      const dt  = new Date(`${e.date}T${e.time || "00:00:00"}`);
      return {
        routerId,
        username:  e.username,
        saleDate:  isNaN(dt.getTime()) ? new Date() : dt,
        price:     String(e.price ?? ""),
        ip:        e.ip       ?? "",
        mac:       e.mac      ?? "",
        validity:  e.validity ?? "",
        label:     e.label    ?? "",
        batch:     e.batch    ?? "",
        rawName:   raw,
      };
    });

    // Upsert in chunks — ignore conflicts (rawName already present)
    const CHUNK = 200;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const result = await db
        .insert(scriptSalesTable)
        .values(rows.slice(i, i + CHUNK))
        .onConflictDoNothing()
        .returning({ id: scriptSalesTable.id });
      inserted += result.length;
    }

    if (inserted > 0) {
      logger.info({ routerId, total: entries.length, inserted }, "script cache: sync complete");
    }
    return inserted;
  } catch (err) {
    logger.warn({ routerId, err }, "script cache: sync failed (non-blocking)");
    return 0;
  }
}

/**
 * Returns a Map<username_lower, CachedSaleDetail> with the first known sale entry
 * (earliest timestamp) per user across the cache for the given router.
 * This aligns `usedAt` with first voucher usage (not latest login/sync).
 */
export async function getCachedSaleDetails(routerId: number): Promise<Map<string, CachedSaleDetail>> {
  const rows = await db
    .select({
      username: scriptSalesTable.username,
      saleDate: scriptSalesTable.saleDate,
      price:    scriptSalesTable.price,
      ip:       scriptSalesTable.ip,
      mac:      scriptSalesTable.mac,
    })
    .from(scriptSalesTable)
    .where(eq(scriptSalesTable.routerId, routerId));

  const map = new Map<string, CachedSaleDetail>();
  for (const row of rows) {
    const key      = row.username.toLowerCase();
    const existing = map.get(key);
    const rowHasNet = Boolean((row.ip ?? "").trim() || (row.mac ?? "").trim());
    const existingHasNet = Boolean((existing?.ip ?? "").trim() || (existing?.mac ?? "").trim());
    if (
      !existing ||
      row.saleDate < existing.saleDate ||
      (row.saleDate.getTime() === existing.saleDate.getTime() && rowHasNet && !existingHasNet)
    ) {
      map.set(key, {
        saleDate:  row.saleDate,
        salePrice: row.price || null,
        ip:        row.ip    || "",
        mac:       row.mac   || "",
      });
    }
  }
  return map;
}

/**
 * Returns all cached script entries whose batch field ends with any of the
 * provided suffixes. Used by syncHistoricalScriptSalesToVendor.
 */
export async function getCachedSalesByBatch(
  routerId: number,
  suffixes: string[],
): Promise<typeof scriptSalesTable.$inferSelect[]> {
  if (suffixes.length === 0) return [];

  const conditions = suffixes.map(
    (s) => sql`${scriptSalesTable.batch} LIKE ${"%" + s}`,
  );

  return db
    .select()
    .from(scriptSalesTable)
    .where(
      and(
        eq(scriptSalesTable.routerId, routerId),
        sql`(${sql.join(conditions, sql` OR `)})`,
      ),
    );
}
