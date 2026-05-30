import { db, routersTable } from "@workspace/db";
import { logger } from "./logger.js";
import { isRouterLocked, withRouterLock } from "./router-lock.js";
import { purgePhantomVouchers } from "./vendor-sync.js";
import { purgeOldMikhmonScriptsFast } from "./mikrotik.js";
import { hasActiveStaffSessions } from "./user-session-store.js";

const HOUR_MS = 60 * 60 * 1000;

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

  try {
    // Purge rapide : une seule connexion MikroTik, scans `?owner=` ciblés
    // par mois, arrêt anticipé. La base PostgreSQL locale n'est jamais
    // touchée — l'historique des ventes reste intégralement disponible.
    const purge = await withRouterLock(router.id, () =>
      purgeOldMikhmonScriptsFast(conn, cutoffYear, cutoffMonth),
    );

    const remaining = Math.max(0, purge.scanned - purge.removed);
    logger.info(
      {
        routerId: router.id,
        host: router.host,
        totalRemoved: purge.removed,
        totalFailed: purge.failed,
        remaining,
        cacheKept: true,
      },
      "maintenance: purge anciens scripts terminée (auto, mensuelle)",
    );
  } catch (err) {
    logger.warn({ routerId: router.id, host: router.host, err }, "maintenance: purge anciens scripts a échoué");
  }
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
  if (!(await hasActiveStaffSessions())) return;

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
