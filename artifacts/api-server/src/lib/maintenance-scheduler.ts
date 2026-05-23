import { db, routersTable } from "@workspace/db";
import { logger } from "./logger.js";
import { isRouterLocked, withRouterLock } from "./router-lock.js";
import { purgePhantomVouchers } from "./vendor-sync.js";
import { purgeOldMikhmonScripts } from "./mikrotik.js";
import { clearRouterScriptCache } from "./script-cache.js";

const HOUR_MS = 60 * 60 * 1000;
const SCRIPT_PURGE_BATCH_SIZE = 50;
const SCRIPT_PURGE_MAX_BATCHES_PER_ROUTER = 200;

let started = false;
let lastScriptPurgeYmd: string | null = null;

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function listAllRouters(): Promise<Array<{ id: number; host: string; name: string | null; port: number; username: string; password: string }>> {
  return db
    .select({
      id: routersTable.id,
      host: routersTable.host,
      name: routersTable.name,
      port: routersTable.port,
      username: routersTable.username,
      password: routersTable.password,
    })
    .from(routersTable);
}

async function runHourlyPhantomPurge(): Promise<void> {
  let routers: Awaited<ReturnType<typeof listAllRouters>>;
  try {
    routers = await listAllRouters();
  } catch (err) {
    logger.warn({ err }, "maintenance: échec lecture liste routeurs (purge fantômes)");
    return;
  }

  for (const r of routers) {
    if (isRouterLocked(r.id)) {
      logger.info({ routerId: r.id, host: r.host }, "maintenance: routeur verrouillé — purge fantômes ignorée");
      continue;
    }
    try {
      const result = await purgePhantomVouchers(r.id);
      logger.info(
        {
          routerId: r.id,
          host: r.host,
          deleted: result.deleted,
          unsoldInDb: result.unsoldInDb,
          activeUsersCount: result.activeUsersCount,
          skipped: result.skipped,
          reason: result.reason,
        },
        "maintenance: purge fantômes (auto, horaire)",
      );
    } catch (err) {
      logger.warn({ routerId: r.id, host: r.host, err }, "maintenance: purge fantômes a échoué");
    }
  }
}

async function runMonthlyScriptPurgeForRouter(
  router: { id: number; host: string; name: string | null; port: number; username: string; password: string },
  cutoffYear: number,
  cutoffMonth: number,
): Promise<void> {
  if (isRouterLocked(router.id)) {
    logger.info({ routerId: router.id, host: router.host }, "maintenance: routeur verrouillé — purge scripts ignorée");
    return;
  }

  const conn = { host: router.host, port: router.port, username: router.username, password: router.password };

  let totalRemoved = 0;
  let totalFailed = 0;
  let lastRemaining = Number.POSITIVE_INFINITY;

  for (let batch = 0; batch < SCRIPT_PURGE_MAX_BATCHES_PER_ROUTER; batch++) {
    try {
      const { isDone, remaining, removed, failed, cacheRowsDeleted } = await withRouterLock(router.id, async () => {
        const purgeRes = await purgeOldMikhmonScripts(conn, cutoffYear, cutoffMonth, { limit: SCRIPT_PURGE_BATCH_SIZE });
        const remainingAfter = Math.max(0, purgeRes.scanned - purgeRes.removed);
        const done = remainingAfter === 0 && purgeRes.failed === 0;

        if (done) {
          clearRouterScriptCache(router.id);
        }

        return { isDone: done, remaining: remainingAfter, removed: purgeRes.removed, failed: purgeRes.failed, cacheRowsDeleted: 0 };
      });

      totalRemoved += removed;
      totalFailed += failed;

      if (isDone) {
        logger.info(
          { routerId: router.id, host: router.host, totalRemoved, totalFailed, batches: batch + 1, cacheRowsDeleted },
          "maintenance: purge anciens scripts terminée (auto, mensuelle)",
        );
        return;
      }

      // No-progress guard: if a batch removed nothing AND remaining didn't drop,
      // stop to avoid spinning on persistent failures.
      if (removed === 0 || remaining >= lastRemaining) {
        logger.warn(
          { routerId: router.id, host: router.host, totalRemoved, totalFailed, remaining, batches: batch + 1 },
          "maintenance: purge anciens scripts arrêtée (pas de progrès)",
        );
        return;
      }
      lastRemaining = remaining;
    } catch (err) {
      logger.warn({ routerId: router.id, host: router.host, err }, "maintenance: purge anciens scripts a échoué");
      return;
    }
  }

  logger.warn(
    { routerId: router.id, host: router.host, totalRemoved, totalFailed, maxBatches: SCRIPT_PURGE_MAX_BATCHES_PER_ROUTER },
    "maintenance: purge anciens scripts arrêtée (limite de batches atteinte)",
  );
}

async function runMonthlyScriptPurgeIfDue(): Promise<void> {
  const now = new Date();
  if (now.getDate() !== 1) return;

  const ymd = todayYmd();
  if (lastScriptPurgeYmd === ymd) return;
  lastScriptPurgeYmd = ymd;

  // Cutoff = first day of previous month. Anything strictly before is removed.
  const cutoffYear  = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const cutoffMonth = now.getMonth() === 0 ? 12 : now.getMonth(); // 1-12, = previous month

  let routers: Awaited<ReturnType<typeof listAllRouters>>;
  try {
    routers = await listAllRouters();
  } catch (err) {
    logger.warn({ err }, "maintenance: échec lecture liste routeurs (purge scripts)");
    return;
  }

  logger.info(
    { cutoff: `${cutoffYear}-${String(cutoffMonth).padStart(2, "0")}-01`, routers: routers.length },
    "maintenance: démarrage purge mensuelle des anciens scripts MikHmon",
  );

  for (const r of routers) {
    await runMonthlyScriptPurgeForRouter(r, cutoffYear, cutoffMonth);
  }
}

async function tick(): Promise<void> {
  try {
    await runHourlyPhantomPurge();
  } catch (err) {
    logger.error({ err }, "maintenance: erreur inattendue (purge fantômes)");
  }
  try {
    await runMonthlyScriptPurgeIfDue();
  } catch (err) {
    logger.error({ err }, "maintenance: erreur inattendue (purge scripts)");
  }
}

/**
 * Démarre le planificateur de maintenance :
 *   - Toutes les heures : purge des « vouchers fantômes » sur chaque routeur
 *     (DB rows non vendus absents de MikroTik).
 *   - Le 1er de chaque mois : suppression des anciens scripts de ventes
 *     MikHmon (conserve mois courant + mois précédent), batchée par routeur.
 *
 * Idempotent : appelable plusieurs fois, ne démarre qu'un seul timer.
 * Les routeurs verrouillés (génération en cours) sont ignorés et seront
 * traités au prochain tick.
 */
export function startMaintenanceScheduler(): void {
  if (started) return;
  started = true;

  // Petit délai au démarrage pour laisser le serveur finir son warm-up
  // (warmProfileSnapshots, vendor sync initial, etc.) avant d'ouvrir des
  // connexions MikroTik supplémentaires.
  const FIRST_RUN_DELAY = 60_000;

  const schedule = (delay: number): void => {
    setTimeout(() => {
      void tick().finally(() => schedule(HOUR_MS));
    }, delay).unref?.();
  };

  schedule(FIRST_RUN_DELAY);
  logger.info({ intervalMs: HOUR_MS, firstRunInMs: FIRST_RUN_DELAY }, "maintenance: planificateur démarré");
}
