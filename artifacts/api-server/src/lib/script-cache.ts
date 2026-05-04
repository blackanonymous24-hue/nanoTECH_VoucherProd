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
import { fetchScriptSales, removeMikhmonScriptsByRawNames, type RouterConnection } from "./mikrotik.js";
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

/** Timestamp of last SUCCESSFUL full load per router — forces a new full load every 1 h */
const lastFullLoadAt = new Map<number, number>();
const FULL_RELOAD_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Last attempt timestamp (success OR failure) per router. Used to back off
 * after a failed full-load so we don't hammer an unresponsive router every
 * 20s tick (each failed full-load can hold a 120s timeout slot per vendor).
 *
 * Backoff is exponential: starts at FULL_LOAD_BACKOFF_MIN_MS, doubles after
 * each consecutive failure, capped at FULL_LOAD_BACKOFF_MAX_MS. This way a
 * router that recovers quickly (reboot/network flap) gets re-tried within
 * ~1 min, while a chronically unreachable router is only retried every 10 min.
 */
const lastFullLoadAttemptAt = new Map<number, number>();
const fullLoadFailStreak     = new Map<number, number>();
const FULL_LOAD_BACKOFF_MIN_MS =      60 * 1000; // 1  min  (after 1 failure)
const FULL_LOAD_BACKOFF_MAX_MS = 10 * 60 * 1000; // 10 min  (after many)
/**
 * Throttle for incremental syncs (per router). Prevents N vendors on the same
 * router from each issuing the same incremental query within the same tick.
 */
const lastIncrementalAt = new Map<number, number>();
const INCREMENTAL_MIN_GAP_MS = 15 * 1000; // 15 seconds — near-real-time script discovery

/**
 * In-flight dedup: when several vendors on the same router call syncScriptCache
 * concurrently, share a single promise instead of opening multiple MikroTik
 * sessions for the same data.
 */
const inFlight = new Map<number, Promise<number>>();

/**
 * Force the next syncScriptCache call for this router to do a full reload
 * regardless of whether it was already "fully populated".
 */
export function clearRouterScriptCache(routerId: number): void {
  fullyPopulated.delete(routerId);
  lastFullLoadAt.delete(routerId);
  lastFullLoadAttemptAt.delete(routerId);
  fullLoadFailStreak.delete(routerId);
  lastIncrementalAt.delete(routerId);
  // Note: we do NOT clear `inFlight` here. If a sync is already running for
  // this router, the next caller will share that result (it's about to insert
  // the latest data anyway). Clearing it would risk opening a parallel
  // MikroTik session for the same router, which is exactly what we just
  // hardened against.
}

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
  // ── In-flight dedup ──────────────────────────────────────────────────
  // If another caller is already syncing this router, await its result
  // instead of issuing a parallel MikroTik session for the same data.
  const existing = inFlight.get(routerId);
  if (existing) return existing;

  const promise = (async () => {
    try {
      // Check if we already have data for this router
      const [countRow] = await db
        .select({ n: sql<number>`count(*)` })
        .from(scriptSalesTable)
        .where(eq(scriptSalesTable.routerId, routerId));

      const isEmpty = Number(countRow?.n ?? 0) === 0;
      const lastFull = lastFullLoadAt.get(routerId) ?? 0;
      const fullLoadStale = Date.now() - lastFull > FULL_RELOAD_INTERVAL_MS;
      const needsFullLoad = isEmpty || !fullyPopulated.has(routerId) || fullLoadStale;

      let entries: Awaited<ReturnType<typeof fetchScriptSales>>;

    if (needsFullLoad) {
      // Back off after consecutive failures (exponential, capped at 10 min).
      // Successful loads reset the streak so the next failure starts again at 1 min.
      const failStreak  = fullLoadFailStreak.get(routerId) ?? 0;
      const lastAttempt = lastFullLoadAttemptAt.get(routerId) ?? 0;
      if (failStreak > 0 && lastAttempt > 0) {
        const backoff = Math.min(
          FULL_LOAD_BACKOFF_MIN_MS * 2 ** (failStreak - 1),
          FULL_LOAD_BACKOFF_MAX_MS,
        );
        if (Date.now() - lastAttempt < backoff) {
          return 0; // skip silently; will retry after backoff
        }
      }

      // Full load: all historical scripts — heavy, done once per router then every 1 h
      logger.info({ routerId, reason: isEmpty ? "empty" : fullLoadStale ? "stale(1h)" : "first-run" },
        "script cache: full load started");
      lastFullLoadAttemptAt.set(routerId, Date.now()); // mark BEFORE the call
      try {
        entries = await fetchScriptSales(conn, { type: "all" }, 120_000);
      } catch (err) {
        // Bump the consecutive-failure counter so the next attempt waits longer
        fullLoadFailStreak.set(routerId, failStreak + 1);
        throw err;
      }
      // Success: clear failure streak
      fullLoadFailStreak.delete(routerId);
      fullyPopulated.add(routerId);
      lastFullLoadAt.set(routerId, Date.now());
    } else {
      // Throttle incremental syncs per router (multiple vendors share the same data)
      const lastInc = lastIncrementalAt.get(routerId) ?? 0;
      if (Date.now() - lastInc < INCREMENTAL_MIN_GAP_MS) {
        return 0;
      }
      // Incremental: fetch this month + last month only.
      // NOTE: lastIncrementalAt is set AFTER a successful fetch so that a
      // MikroTik timeout or auth error does not block the next retry for 15 s.
      const now = new Date();
      const thisYear  = now.getFullYear();
      const thisMonth = now.getMonth() + 1; // 1-12
      const lastYear  = thisMonth === 1 ? thisYear - 1 : thisYear;
      const lastMonth = thisMonth === 1 ? 12 : thisMonth - 1;

      const [a, b] = await Promise.all([
        fetchScriptSales(conn, { type: "month", year: thisYear,  month: thisMonth }, 30_000),
        fetchScriptSales(conn, { type: "month", year: lastYear,  month: lastMonth }, 30_000),
      ]);
      // Only stamp the throttle after a successful fetch
      lastIncrementalAt.set(routerId, Date.now());
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

      const [routerCfg] = await db
        .select({ autoDeleteSalesScripts: routersTable.autoDeleteSalesScripts })
        .from(routersTable)
        .where(eq(routersTable.id, routerId))
        .limit(1);

      if (routerCfg?.autoDeleteSalesScripts) {
        // Auto-clean on router: once the sale scripts are present locally,
        // remove their MikHMon script entries to prevent accumulation.
        // Non-blocking for business flow: local cache remains source of truth.
        try {
          const rawNames = rows.map((r) => r.rawName).filter(Boolean);
          const cleaned = await removeMikhmonScriptsByRawNames(conn, rawNames);
          if (cleaned.removed > 0 || cleaned.failed > 0) {
            logger.info(
              { routerId, removed: cleaned.removed, failed: cleaned.failed, scanned: cleaned.scanned },
              "script cache: auto-cleaned MikroTik scripts after local persist",
            );
          }
        } catch (cleanupErr) {
          logger.warn({ routerId, err: cleanupErr }, "script cache: MikroTik auto-clean failed (non-blocking)");
        }
      }

      if (inserted > 0) {
        logger.info({ routerId, total: entries.length, inserted }, "script cache: sync complete");
      }
      return inserted;
    } catch (err) {
      logger.warn({ routerId, err }, "script cache: sync failed (non-blocking)");
      return 0;
    } finally {
      inFlight.delete(routerId);
    }
  })();

  inFlight.set(routerId, promise);
  return promise;
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
