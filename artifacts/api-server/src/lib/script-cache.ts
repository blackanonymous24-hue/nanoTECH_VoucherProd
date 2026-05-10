/**
 * Script Cache — local mirror of MikHMon sales script entries.
 *
 * Instead of querying MikroTik for thousands of scripts on every sync,
 * this module:
 *   1. Nouveau routeur (cache DB vide) → mois en cours seulement, puis historique en arrière-plan
 *   2. Sinon → incrémental mois courant + mois précédent (séquentiel), ou full reload si TTL 1 h
 *   3. Lookups rapides en base (détails vente, lots)
 *
 * This eliminates the heavy ?comment=mikhmon call from the hot sync path and
 * relieves the MikroTik CPU significantly.
 */
import { eq, and, sql, inArray } from "drizzle-orm";
import { db, scriptSalesTable, routersTable } from "@workspace/db";
import { fetchScriptSales, removeMikhmonScriptsByRawNames, type RouterConnection } from "./mikrotik.js";
import { isRouterLocked } from "./router-lock.js";
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
 * Backoff cycling: 1 min → 2 min → 4 min → 1 min → 2 min → 4 min → …
 * The cycle repeats indefinitely so the max wait is always 4 minutes.
 * A successful load resets the streak so the next failure restarts at 1 min.
 */
const lastFullLoadAttemptAt = new Map<number, number>();
const fullLoadFailStreak     = new Map<number, number>();
const FULL_LOAD_BACKOFF_MIN_MS = 60 * 1000; // 1 min base (step 0 of cycle)
const FULL_LOAD_BACKOFF_STEPS  = 3;         // cycle length: 1 min, 2 min, 4 min
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

/** Différé après sync « mois en cours » — charge tout l’historique quand le routeur n’est pas verrouillé. */
const scriptHistoryBackfillTimer = new Map<number, ReturnType<typeof setTimeout>>();

type SaleEntryRow = Awaited<ReturnType<typeof fetchScriptSales>>[number];

async function fetchIncrementalScriptMonths(conn: RouterConnection): Promise<SaleEntryRow[]> {
  const now = new Date();
  const thisYear  = now.getFullYear();
  const thisMonth = now.getMonth() + 1;
  const lastYear  = thisMonth === 1 ? thisYear - 1 : thisYear;
  const lastMonth = thisMonth === 1 ? 12 : thisMonth - 1;
  const current = await fetchScriptSales(conn, { type: "month", year: thisYear, month: thisMonth }, 30_000);
  const previous = await fetchScriptSales(conn, { type: "month", year: lastYear, month: lastMonth }, 30_000);
  return [...current, ...previous];
}

async function persistScriptCacheEntries(
  routerId: number,
  conn: RouterConnection,
  entries: SaleEntryRow[],
): Promise<number> {
  if (entries.length === 0) return 0;

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
    const rawNamesToDelete = rows.map((r) => r.rawName).filter(Boolean);

    if (rawNamesToDelete.length > 0) {
      try {
        const DB_CHUNK = 500;
        let confirmedCount = 0;
        for (let i = 0; i < rawNamesToDelete.length; i += DB_CHUNK) {
          const chunk = rawNamesToDelete.slice(i, i + DB_CHUNK);
          const [row] = await db
            .select({ n: sql<number>`count(*)::int` })
            .from(scriptSalesTable)
            .where(
              and(
                eq(scriptSalesTable.routerId, routerId),
                inArray(scriptSalesTable.rawName, chunk),
              ),
            );
          confirmedCount += Number(row?.n ?? 0);
        }

        if (confirmedCount < rawNamesToDelete.length) {
          logger.error(
            {
              routerId,
              fetchedFromMikrotik: rawNamesToDelete.length,
              confirmedInDb: confirmedCount,
              missing: rawNamesToDelete.length - confirmedCount,
            },
            "script cache: auto-delete ANNULÉ — entrées manquantes en base locale, suppression MikroTik refusée pour éviter la perte de données",
          );
        } else {
          const cleaned = await removeMikhmonScriptsByRawNames(conn, rawNamesToDelete);
          if (cleaned.removed > 0 || cleaned.failed > 0) {
            logger.info(
              { routerId, removed: cleaned.removed, failed: cleaned.failed, scanned: cleaned.scanned },
              "script cache: auto-cleaned MikroTik scripts après confirmation base locale",
            );
          }
        }
      } catch (cleanupErr) {
        logger.warn({ routerId, err: cleanupErr }, "script cache: MikroTik auto-clean failed (non-blocking)");
      }
    }
  }

  if (inserted > 0) {
    logger.info({ routerId, total: entries.length, inserted }, "script cache: sync complete");
  }
  return inserted;
}

function scheduleScriptHistoryBackfill(routerId: number, conn: RouterConnection): void {
  if (scriptHistoryBackfillTimer.has(routerId)) return;
  const connSnap = { ...conn };

  const scheduleRetry = (delayMs: number) => {
    const prev = scriptHistoryBackfillTimer.get(routerId);
    if (prev) clearTimeout(prev);
    scriptHistoryBackfillTimer.set(
      routerId,
      setTimeout(() => void runBackfill(), delayMs),
    );
  };

  async function runBackfill() {
    scriptHistoryBackfillTimer.delete(routerId);
    if (isRouterLocked(routerId)) {
      scheduleRetry(5_000);
      return;
    }
    try {
      logger.info({ routerId }, "script cache: historical backfill (all months) starting");
      const allEntries = await fetchScriptSales(connSnap, { type: "all" }, 120_000);
      const inserted = await persistScriptCacheEntries(routerId, connSnap, allEntries);
      lastFullLoadAt.set(routerId, Date.now());
      fullLoadFailStreak.delete(routerId);
      logger.info({ routerId, fetched: allEntries.length, inserted }, "script cache: historical backfill complete");
    } catch (err) {
      logger.warn({ routerId, err }, "script cache: historical backfill failed — retry in 60s");
      scheduleRetry(60_000);
    }
  }

  scheduleRetry(10_000);
}

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
  const bf = scriptHistoryBackfillTimer.get(routerId);
  if (bf) clearTimeout(bf);
  scriptHistoryBackfillTimer.delete(routerId);
  // Note: we do NOT clear `inFlight` here. If a sync is already running for
  // this router, the next caller will share that result (it's about to insert
  // the latest data anyway). Clearing it would risk opening a parallel
  // MikroTik session for the same router, which is exactly what we just
  // hardened against.
}

/**
 * Synchronise the local script cache for a router.
 *
 * - Première synchro (DB vide pour ce routeur) → **mois en cours uniquement** (léger),
 *   puis complément historique complet en arrière-plan quand le routeur n’est pas verrouillé.
 * - Rechargement complet (TTL 1 h) → reporté si `isRouterLocked` ; passe alors en incrémental léger.
 * - Sinon → mois en cours puis mois précédent (séquentiel, deux appels légers).
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

      // ── Bootstrap: after a server restart the in-memory flags are cleared, but
      // the DB already holds the full history from a previous session.  Without
      // this guard every router enters the "needsFullLoad" path immediately; if
      // the full load fails (timeout / wrong password) the router gets stuck in
      // the exponential-backoff retry loop and incremental syncs NEVER run —
      // meaning new scripts generated on MikroTik are never inserted into the DB.
      //
      // Fix: when the DB is non-empty and this process has not yet recorded a
      // full-load timestamp, treat the existing rows as the baseline and defer
      // the first full reload by 5 minutes.  Incremental syncs (current + last
      // month) start immediately and pick up all new sales.
      if (!isEmpty && !lastFullLoadAt.has(routerId)) {
        fullyPopulated.add(routerId);
        // Pretend the last full load finished 55 min ago so the 1-h refresh
        // fires ~5 min from now rather than on the very first call.
        lastFullLoadAt.set(routerId, Date.now() - FULL_RELOAD_INTERVAL_MS + 5 * 60_000);
        logger.info({ routerId }, "script cache: bootstrapped from existing DB rows — incremental mode");
      }

      const lastFull = lastFullLoadAt.get(routerId) ?? 0;
      const fullLoadStale = Date.now() - lastFull > FULL_RELOAD_INTERVAL_MS;
      const needsFullLoad = isEmpty || fullLoadStale;

      let entries: SaleEntryRow[] = [];

      const respectFullLoadBackoff = (): boolean => {
        const failStreak = fullLoadFailStreak.get(routerId) ?? 0;
        const lastAttempt = lastFullLoadAttemptAt.get(routerId) ?? 0;
        if (failStreak > 0 && lastAttempt > 0) {
          const cycleStep = (failStreak - 1) % FULL_LOAD_BACKOFF_STEPS;
          const backoff   = FULL_LOAD_BACKOFF_MIN_MS * 2 ** cycleStep;
          if (Date.now() - lastAttempt < backoff) return true;
        }
        return false;
      };

      if (needsFullLoad && isEmpty) {
        if (respectFullLoadBackoff()) return 0;

        logger.info({ routerId }, "script cache: priority sync — current month only (historical backfill deferred)");
        lastFullLoadAttemptAt.set(routerId, Date.now());
        try {
          const now = new Date();
          entries = await fetchScriptSales(
            conn,
            { type: "month", year: now.getFullYear(), month: now.getMonth() + 1 },
            45_000,
          );
        } catch (err) {
          fullLoadFailStreak.set(routerId, (fullLoadFailStreak.get(routerId) ?? 0) + 1);
          throw err;
        }
        fullLoadFailStreak.delete(routerId);
        fullyPopulated.add(routerId);
        lastFullLoadAt.set(routerId, Date.now());
        scheduleScriptHistoryBackfill(routerId, conn);
      } else if (needsFullLoad && !isEmpty && !isRouterLocked(routerId)) {
        if (respectFullLoadBackoff()) return 0;

        logger.info({ routerId, reason: "stale(1h)" }, "script cache: full load started");
        lastFullLoadAttemptAt.set(routerId, Date.now());
        try {
          entries = await fetchScriptSales(conn, { type: "all" }, 120_000);
        } catch (err) {
          fullLoadFailStreak.set(routerId, (fullLoadFailStreak.get(routerId) ?? 0) + 1);
          throw err;
        }
        fullLoadFailStreak.delete(routerId);
        fullyPopulated.add(routerId);
        lastFullLoadAt.set(routerId, Date.now());
      } else if (needsFullLoad && !isEmpty && isRouterLocked(routerId)) {
        const lastInc = lastIncrementalAt.get(routerId) ?? 0;
        if (Date.now() - lastInc < INCREMENTAL_MIN_GAP_MS) {
          return 0;
        }
        logger.info({ routerId }, "script cache: full reload deferred (router locked) — incremental pass");
        entries = await fetchIncrementalScriptMonths(conn);
        lastIncrementalAt.set(routerId, Date.now());
      } else {
        const lastInc = lastIncrementalAt.get(routerId) ?? 0;
        if (Date.now() - lastInc < INCREMENTAL_MIN_GAP_MS) {
          return 0;
        }
        entries = await fetchIncrementalScriptMonths(conn);
        lastIncrementalAt.set(routerId, Date.now());
      }

      return await persistScriptCacheEntries(routerId, conn, entries);
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
