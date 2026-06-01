/**
 * Script Cache — local mirror of MikHMon sales script entries.
 *
 * Stratégie de synchronisation incrémentale et progressive :
 *   1. Premier branchement (DB vide pour le routeur) :
 *      • on récupère UNIQUEMENT les scripts du mois en cours pour afficher
 *        les cartes du dashboard très vite (~5–10 s vs 60–120 s pour tout).
 *      • on lance un backfill historique silencieux en arrière-plan qui
 *        rapatrie mois par mois (M-1 → M-12), avec une pause entre chaque
 *        mois pour ne pas saturer le CPU MikroTik.
 *
 *   2. Refresh dashboard / changement de routeur / clic depuis la page Router :
 *      • si le mois en cours a déjà été synchronisé récemment (< 1 h), on
 *        ne récupère que les scripts du JOUR en cours → ultra rapide
 *        (~2–3 s) et toujours temps réel.
 *      • sinon on rafraîchit le mois en cours.
 *
 *   3. Tâche de fond périodique : tous les 1 h, on resync le mois en cours
 *      pour rattraper d'éventuels scripts insérés tardivement.
 */
import { eq, and, sql, inArray, desc, asc, gte, lt } from "drizzle-orm";
import { db, scriptSalesTable, scriptSalesMonthSyncTable, routersTable } from "@workspace/db";
import {
  fetchScriptSales,
  getRouterInfo,
  parseMikhmonDate,
  removeMikhmonScriptsByRawNames,
  type RouterConnection,
  type SaleEntry,
} from "./mikrotik.js";
import {
  getMikhmonCalendar,
  isCalendarMonthBefore,
  mikhmonMonthRange,
  mikhmonMonthRangeFor,
  type MikhmonCalendar,
} from "./mikhmon-calendar.js";
import { invalidateVendorPeriodAggCache } from "./vendor-period-agg-cache.js";
import { scriptSaleLogicalKey } from "./script-sales-dedup.js";
import {
  countScriptSalesInMonth,
  isPastMonthVerified,
  monthHadMikrotikSync,
  upsertMonthSyncRecord,
  getMonthSyncRow,
  clearRouterMonthSyncMarkers,
} from "./script-sales-month-sync.js";
import { logger } from "./logger.js";

/** Shape returned by getCachedSaleDetails — mirrors mikrotik.ts SaleDetail */
export interface CachedSaleDetail {
  saleDate:  Date;
  salePrice: string | null;
  ip:        string;
  mac:       string;
}

/** Combien de mois antérieurs on rapatrie en arrière-plan après le 1er branchement */
const BACKFILL_MAX_MONTHS = 12;
/** Pause entre 2 mois de backfill historique — laisse souffler le MikroTik */
const BACKFILL_PAUSE_MS   = 3_000;
/** Combien de temps un mois est considéré « frais » (sync du mois entier inutile) */
const MONTH_FRESHNESS_MS  = 60 * 60 * 1000; // 1 h
/** Throttle minimal entre 2 sync « jour courant » sur le même routeur */
const DAY_SYNC_MIN_GAP_MS = 10 * 1000;      // 10 s
/** Rapport ventes : resync MikroTik du mois demandé au plus toutes les 2 min (sync arrière-plan) */
const REPORT_MONTH_SYNC_GAP_MS = 2 * 60 * 1000;
/** Mois déjà aligné MikroTik récemment → réponse rapport instantanée (cache local) */
const REPORT_INSTANT_TRUST_MS = 5 * 60 * 1000;

/** En mémoire : dernier instant où chaque mois (par routeur) a été entièrement sync */
const monthSyncedAt   = new Map<string, number>(); // key = `${routerId}:${year}-${month}`
/** En mémoire : dernier sync « jour courant » par routeur */
const lastDaySyncAt   = new Map<number, number>();
/** Routeurs pour lesquels un backfill historique est déjà en cours */
const backfillRunning = new Set<number>();

/** Dédup : 1 seule sync à la fois par routeur (les vendeurs sur le même routeur partagent) */
const inFlight = new Map<number, Promise<number>>();
/** Sync mois ciblée (rapport ventes) — une par routeur × mois */
const monthReportSyncInFlight = new Map<string, Promise<{ inserted: number; fetched: number; skipped: boolean }>>();

function monthKey(routerId: number, year: number, month: number): string {
  return `${routerId}:${year}-${month}`;
}

/**
 * Force la prochaine sync à tout reprendre depuis le mois courant
 * (utile en mode admin / force-sync).
 */
export function clearRouterScriptCache(routerId: number): void {
  for (const k of Array.from(monthSyncedAt.keys())) {
    if (k.startsWith(`${routerId}:`)) monthSyncedAt.delete(k);
  }
  lastDaySyncAt.delete(routerId);
  void clearRouterMonthSyncMarkers(routerId).catch(() => { /* non-blocking */ });
  // Note : on ne touche pas à `inFlight` — si une sync est en cours, elle finira
  // naturellement et le prochain appelant relancera une nouvelle sync derrière.
}

/**
 * Efface le cache ventes local (scripts MikHmon en base) pour un routeur.
 * Les scripts sur le MikroTik ne sont pas touchés — la prochaine sync les réimporte.
 */
export async function resetRouterSalesCache(routerId: number): Promise<{
  deletedSales: number;
  deletedMarkers: number;
}> {
  const deleted = await db
    .delete(scriptSalesTable)
    .where(eq(scriptSalesTable.routerId, routerId))
    .returning({ id: scriptSalesTable.id });
  const markerRows = await db
    .delete(scriptSalesMonthSyncTable)
    .where(eq(scriptSalesMonthSyncTable.routerId, routerId))
    .returning({ id: scriptSalesMonthSyncTable.id });
  clearRouterScriptCache(routerId);
  logger.info(
    { routerId, deletedSales: deleted.length, deletedMarkers: markerRows.length },
    "script cache: reset ventes local (DB + marqueurs mois)",
  );
  return { deletedSales: deleted.length, deletedMarkers: markerRows.length };
}

/** Réhydrate le throttle mois courant depuis la base (survit au restart API). */
async function hydrateCurrentMonthSyncMarker(
  routerId: number,
  year: number,
  month: number,
): Promise<void> {
  const key = monthKey(routerId, year, month);
  if (monthSyncedAt.has(key)) return;
  const row = await getMonthSyncRow(routerId, year, month);
  if (row?.lastSyncAt) monthSyncedAt.set(key, row.lastSyncAt.getTime());
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers internes : transformation entries → rows + persistance + auto-delete
// ────────────────────────────────────────────────────────────────────────────

interface ScriptSalesRow {
  routerId: number;
  username: string;
  saleDate: Date;
  price:    string;
  ip:       string;
  mac:      string;
  validity: string;
  label:    string;
  batch:    string;
  rawName:  string;
}

function entriesToRows(routerId: number, entries: SaleEntry[]): ScriptSalesRow[] {
  return entries.map((e) => {
    const raw = [e.date, e.time, e.username, e.price, e.ip, e.mac, e.validity, e.label, e.batch].join("-|-");
    const dt  = parseMikhmonDate(e.date, e.time || "00:00:00");
    return {
      routerId,
      username:  e.username,
      saleDate:  dt ?? new Date(),
      price:     String(e.price ?? ""),
      ip:        e.ip       ?? "",
      mac:       e.mac      ?? "",
      validity:  e.validity ?? "",
      label:     e.label    ?? "",
      batch:     e.batch    ?? "",
      rawName:   raw,
    };
  });
}

async function persistRows(rows: ScriptSalesRow[]): Promise<number> {
  if (rows.length === 0) return 0;
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
  return inserted;
}

/**
 * Supprime uniquement les doublons techniques (même vente insérée 2× avec rawName
 * différent). Ne supprime jamais une vente parce que le script n'est plus sur le routeur.
 */
async function dedupeScriptSalesInRange(
  routerId: number,
  monthStart: Date,
  monthEnd: Date,
): Promise<number> {
  const rows = await db
    .select({
      id: scriptSalesTable.id,
      username: scriptSalesTable.username,
      saleDate: scriptSalesTable.saleDate,
      price: scriptSalesTable.price,
      ip: scriptSalesTable.ip,
      mac: scriptSalesTable.mac,
    })
    .from(scriptSalesTable)
    .where(and(
      eq(scriptSalesTable.routerId, routerId),
      gte(scriptSalesTable.saleDate, monthStart),
      lt(scriptSalesTable.saleDate, monthEnd),
    ))
    .orderBy(asc(scriptSalesTable.id));

  const keepIdByKey = new Map<string, number>();
  const duplicateIds: number[] = [];

  for (const row of rows) {
    const saleDate = row.saleDate instanceof Date ? row.saleDate : new Date(row.saleDate);
    const key = scriptSaleLogicalKey(row.username, saleDate, row.price, row.ip, row.mac, row.rawName);
    const existingId = keepIdByKey.get(key);
    if (existingId == null) {
      keepIdByKey.set(key, row.id);
    } else {
      duplicateIds.push(row.id);
    }
  }

  if (duplicateIds.length === 0) return 0;

  const CHUNK = 500;
  for (let i = 0; i < duplicateIds.length; i += CHUNK) {
    await db
      .delete(scriptSalesTable)
      .where(inArray(scriptSalesTable.id, duplicateIds.slice(i, i + CHUNK)));
  }

  logger.info(
    { routerId, duplicatesRemoved: duplicateIds.length, monthStart: monthStart.toISOString() },
    "script cache: doublons techniques supprimés (historique conservé)",
  );
  return duplicateIds.length;
}

/** Insère les scripts manquants + dédoublonne — sans effacer l'historique purgé sur MikroTik. */
async function appendMonthScriptSales(
  routerId: number,
  rows: ScriptSalesRow[],
  monthStart: Date,
  monthEnd: Date,
): Promise<{ inserted: number; deduped: number }> {
  const inserted = await persistRows(rows);
  const deduped = await dedupeScriptSalesInRange(routerId, monthStart, monthEnd);
  return { inserted, deduped };
}

/**
 * Suppression auto des scripts MikroTik — SÉCURISÉE :
 * on ne supprime jamais sans avoir confirmé en DB que chaque rawName est bien
 * persisté. Toute divergence annule entièrement la suppression.
 */
async function autoCleanMikrotikIfEnabled(
  routerId: number,
  conn: RouterConnection,
  rows: ScriptSalesRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const [routerCfg] = await db
    .select({ autoDeleteSalesScripts: routersTable.autoDeleteSalesScripts })
    .from(routersTable)
    .where(eq(routersTable.id, routerId))
    .limit(1);

  if (!routerCfg?.autoDeleteSalesScripts) return;

  const rawNamesToDelete = rows.map((r) => r.rawName).filter(Boolean);
  if (rawNamesToDelete.length === 0) return;

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
      return;
    }

    const cleaned = await removeMikhmonScriptsByRawNames(conn, rawNamesToDelete);
    if (cleaned.removed > 0 || cleaned.failed > 0) {
      logger.info(
        { routerId, removed: cleaned.removed, failed: cleaned.failed, scanned: cleaned.scanned },
        "script cache: auto-cleaned MikroTik scripts après confirmation base locale",
      );
    }
  } catch (cleanupErr) {
    logger.warn({ routerId, err: cleanupErr }, "script cache: MikroTik auto-clean failed (non-blocking)");
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Backfill historique en arrière-plan
// ────────────────────────────────────────────────────────────────────────────

/**
 * Lance (fire-and-forget) le rapatriement progressif des mois antérieurs.
 * Récupère mois par mois, avec une pause entre chaque, pour ne pas saturer
 * le CPU du MikroTik ni du serveur.
 *
 * S'arrête dès qu'un mois renvoie 0 entrée (les mois plus anciens seront
 * également vides — pas la peine de continuer à scanner).
 */
function scheduleHistoricalBackfill(
  routerId: number,
  conn: RouterConnection,
  cal: ReturnType<typeof getMikhmonCalendar>,
): void {
  if (backfillRunning.has(routerId)) return;
  backfillRunning.add(routerId);

  setImmediate(async () => {
    try {
      logger.info({ routerId }, "script cache: backfill historique démarré en arrière-plan");
      let totalInserted = 0;

      for (let i = 1; i <= BACKFILL_MAX_MONTHS; i++) {
        const dt = new Date(cal.y, cal.m - 1 - i, 1);
        const y  = dt.getFullYear();
        const m  = dt.getMonth() + 1;
        const { start: monthStart, end: monthEnd } = mikhmonMonthRangeFor(y, m);

        if (await isPastMonthVerified(routerId, y, m, cal)) continue;

        const existingInDb = await countScriptSalesInMonth(routerId, y, m);
        if (existingInDb > 0 && await monthHadMikrotikSync(routerId, y, m)) {
          await dedupeScriptSalesInRange(routerId, monthStart, monthEnd);
          const after = await countScriptSalesInMonth(routerId, y, m);
          await upsertMonthSyncRecord(routerId, y, m, after, { verified: true });
          monthSyncedAt.set(monthKey(routerId, y, m), Date.now());
          continue;
        }
        if (existingInDb > 0) {
          logger.info(
            { routerId, year: y, month: m, existingInDb },
            "script cache: mois en base sans preuve MikroTik — re-sync routeur avant marquage vérifié",
          );
        }

        if (i > 1) await new Promise((r) => setTimeout(r, BACKFILL_PAUSE_MS));

        try {
          const entries = await fetchScriptSales(
            conn,
            { type: "month", year: y, month: m },
            30_000,
          );
          const rows = entriesToRows(routerId, entries);
          const { inserted, deduped } = await appendMonthScriptSales(routerId, rows, monthStart, monthEnd);
          monthSyncedAt.set(monthKey(routerId, y, m), Date.now());
          totalInserted += inserted;

          if (entries.length > 0) {
            const totalInDb = await countScriptSalesInMonth(routerId, y, m);
            await upsertMonthSyncRecord(routerId, y, m, totalInDb, { verified: true, mikrotikSync: true });
            logger.info(
              { routerId, year: y, month: m, fetched: entries.length, inserted, deduped },
              "script cache: backfill mois OK",
            );
          } else {
            await upsertMonthSyncRecord(routerId, y, m, 0, { verified: true, mikrotikSync: true });
            logger.info(
              { routerId, stoppedAt: `${y}-${m}`, totalInserted },
              "script cache: backfill historique terminé (mois antérieur vide)",
            );
            break;
          }
        } catch (err) {
          logger.warn(
            { routerId, year: y, month: m, err },
            "script cache: backfill mois en échec (continue)",
          );
        }
      }

      logger.info({ routerId, totalInserted }, "script cache: backfill historique terminé");
    } finally {
      backfillRunning.delete(routerId);
    }
  });
}

// ────────────────────────────────────────────────────────────────────────────
// API publique : syncScriptCache
// ────────────────────────────────────────────────────────────────────────────

/**
 * Synchronise le cache de scripts pour un routeur — stratégie incrémentale.
 *
 * Renvoie le nombre de nouvelles lignes insérées (pour le sync de premier plan ;
 * le backfill historique tourne en arrière-plan et n'est pas comptabilisé ici).
 */
/** Horloge routeur pour calendrier MikHmon (évite décalage jour/mois vs Mikhmon). */
async function resolveRouterClockDate(
  conn: RouterConnection,
  routerClockDate?: string | null,
): Promise<string | null> {
  if (routerClockDate !== undefined) return routerClockDate;
  try {
    const info = await getRouterInfo(conn);
    return info.clockDate ?? null;
  } catch {
    return null;
  }
}

export type SyncScriptCacheOptions = {
  /** Ignore le marqueur « mois frais » et refait un pull mois complet (cache partiel). */
  forceFullMonth?: boolean;
  /** Ne pas lancer le backfill historique (12 mois) — KPI dashboard plus fiables. */
  skipBackfill?: boolean;
  /**
   * Tableau de bord / KPI : toujours rapatrier le mois en cours (comme MikHmon ?owner=may2026),
   * jamais le mode « jour seul » qui faisait mensuel === aujourd'hui.
   */
  forDashboard?: boolean;
};

export async function syncScriptCache(
  routerId: number,
  conn: RouterConnection,
  routerClockDate?: string | null,
  opts?: SyncScriptCacheOptions,
): Promise<number> {
  const existing = inFlight.get(routerId);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const clock = await resolveRouterClockDate(conn, routerClockDate);
      const cal = getMikhmonCalendar(clock);
      const thisYear  = cal.y;
      const thisMonth = cal.m;
      const thisDay   = cal.d;
      const { start: monthStart, end: monthEnd } = mikhmonMonthRange(cal);
      const thisMonthKey = monthKey(routerId, thisYear, thisMonth);

      if (opts?.forceFullMonth) {
        monthSyncedAt.delete(thisMonthKey);
      }

      await sealPreviousCalendarMonth(routerId, conn, cal);
      await hydrateCurrentMonthSyncMarker(routerId, thisYear, thisMonth);

      // ── A. La DB a-t-elle des données pour ce routeur ? ─────────────────
      const [countRow] = await db
        .select({ n: sql<number>`count(*)` })
        .from(scriptSalesTable)
        .where(eq(scriptSalesTable.routerId, routerId));
      const isEmpty = Number(countRow?.n ?? 0) === 0;

      let entries: SaleEntry[] = [];
      let mode: "first-month" | "current-month" | "today-only" | "skipped" = "skipped";

      // ── C. Choix de la stratégie ───────────────────────────────────────
      if (isEmpty) {
        // 1er branchement : on charge UNIQUEMENT le mois en cours pour que le
        // dashboard soit vif. Le reste de l'historique arrive en BG.
        mode = "first-month";
        logger.info(
          { routerId, year: thisYear, month: thisMonth },
          "script cache: 1er branchement — sync du mois en cours seulement",
        );
        entries = await fetchScriptSales(
          conn,
          { type: "month", year: thisYear, month: thisMonth },
          30_000,
        );
        monthSyncedAt.set(thisMonthKey, Date.now());
        if (!opts?.skipBackfill) scheduleHistoricalBackfill(routerId, conn, cal);
      } else {
        const lastMonthSync = monthSyncedAt.get(thisMonthKey) ?? 0;
        const monthIsFresh  = lastMonthSync > 0 && Date.now() - lastMonthSync < MONTH_FRESHNESS_MS;

        if (monthIsFresh && !opts?.forDashboard && !opts?.forceFullMonth) {
          // Hors dashboard : mois frais → sync jour seul (rapide pour usage-sync).
          const lastDay = lastDaySyncAt.get(routerId) ?? 0;
          if (Date.now() - lastDay < DAY_SYNC_MIN_GAP_MS) {
            return 0; // throttle silencieux
          }
          mode = "today-only";
          entries = await fetchScriptSales(
            conn,
            { type: "day", year: thisYear, month: thisMonth, day: thisDay },
            15_000,
          );
          lastDaySyncAt.set(routerId, Date.now());
        } else {
          // Mois en cours pas encore sync (ou trop ancien) → on refait le mois.
          mode = "current-month";
          entries = await fetchScriptSales(
            conn,
            { type: "month", year: thisYear, month: thisMonth },
            30_000,
          );
          monthSyncedAt.set(thisMonthKey, Date.now());
          if (!opts?.skipBackfill) scheduleHistoricalBackfill(routerId, conn, cal);
        }
      }

      if (entries.length === 0 && mode !== "first-month" && mode !== "current-month") return 0;

      const rows = entriesToRows(routerId, entries);
      let inserted: number;
      if (mode === "first-month" || mode === "current-month") {
        const rec = await appendMonthScriptSales(routerId, rows, monthStart, monthEnd);
        inserted = rec.inserted;
        const cnt = await countScriptSalesInMonth(routerId, thisYear, thisMonth);
        await upsertMonthSyncRecord(routerId, thisYear, thisMonth, cnt, {
          verified: false,
          mikrotikSync: true,
        });
      } else {
        // Sync jour seul : n'étend pas la fenêtre « mois frais » (sinon plus de resync mois complet).
        inserted = await persistRows(rows);
      }

      await autoCleanMikrotikIfEnabled(routerId, conn, rows);

      if (inserted > 0 || mode === "current-month" || mode === "first-month") {
        invalidateVendorPeriodAggCache(routerId);
        logger.info(
          { routerId, mode, total: entries.length, inserted },
          "script cache: sync complete",
        );
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

export type EnsureMonthSalesSyncResult = {
  inserted: number;
  fetched: number;
  skipped: boolean;
};

export type ReportMonthSyncPlan = "trusted-cache" | "full-pull";

/**
 * Rapport ventes : cache local déjà aligné MikroTik (pas de pull mois complet)
 * ou pull mois complet requis avant affichage.
 */
export async function planReportMonthSync(
  routerId: number,
  conn: RouterConnection,
  year: number,
  month: number,
): Promise<ReportMonthSyncPlan> {
  if (month < 1 || month > 12) return "trusted-cache";

  const clock = await resolveRouterClockDate(conn, null);
  const cal = getMikhmonCalendar(clock);

  if (await isPastMonthVerified(routerId, year, month, cal)) {
    return "trusted-cache";
  }

  const row = await getMonthSyncRow(routerId, year, month);
  const lastMik = row?.mikrotikSyncAt?.getTime() ?? 0;
  if (lastMik > 0 && Date.now() - lastMik < REPORT_INSTANT_TRUST_MS) {
    return "trusted-cache";
  }

  const isCurrentMonth = year === cal.y && month === cal.m;
  const memKey = monthKey(routerId, year, month);
  const memFresh =
    (monthSyncedAt.get(memKey) ?? 0) > 0
    && Date.now() - (monthSyncedAt.get(memKey) ?? 0) < MONTH_FRESHNESS_MS;
  if (isCurrentMonth && memFresh) {
    return "trusted-cache";
  }

  if (!row?.mikrotikSyncAt) {
    const cnt = await countScriptSalesInMonth(routerId, year, month);
    if (cnt === 0) return "full-pull";
  }

  const isPastMonth = isCalendarMonthBefore(year, month, cal);
  if (isPastMonth && lastMik > 0) {
    return "trusted-cache";
  }

  return "full-pull";
}

/**
 * Rapport ventes : sync complète (ou cache fiable) **avant** lecture DB.
 * Mois déjà aligné → quasi instantané ; sinon pull MikroTik mois entier (dédupliqué si warm/prefetch).
 */
export async function prepareReportMonthForDisplay(
  routerId: number,
  conn: RouterConnection,
  year: number,
  month: number,
  opts?: { force?: boolean; timeoutMs?: number },
): Promise<EnsureMonthSalesSyncResult> {
  return ensureMonthSalesSyncedFromMikrotik(routerId, conn, year, month, opts);
}

/** Précharge le mois en arrière-plan (même promesse que le GET rapport — accélère le clic Filtrer). */
export function warmReportMonthSync(
  routerId: number,
  conn: RouterConnection,
  year: number,
  month: number,
): void {
  void prepareReportMonthForDisplay(routerId, conn, year, month).catch(() => {
    /* prefetch best-effort */
  });
}

/**
 * Rapport ventes / export CSV : rapatrie le mois complet depuis MikroTik avant lecture DB.
 * Évite l'écart Mikhmon (scripts routeur) vs cache partiel (sync jour-seul ou mois « vérifié » incomplet).
 */
export async function ensureMonthSalesSyncedFromMikrotik(
  routerId: number,
  conn: RouterConnection,
  year: number,
  month: number,
  opts?: { force?: boolean; timeoutMs?: number },
): Promise<EnsureMonthSalesSyncResult> {
  if (month < 1 || month > 12) {
    return { inserted: 0, fetched: 0, skipped: true };
  }

  const key = monthKey(routerId, year, month);
  const existing = monthReportSyncInFlight.get(key);
  if (existing) return existing;

  const promise = (async (): Promise<EnsureMonthSalesSyncResult> => {
    try {
      if (!opts?.force) {
        const plan = await planReportMonthSync(routerId, conn, year, month);
        if (plan === "trusted-cache") {
          const clock = await resolveRouterClockDate(conn, null);
          const cal = getMikhmonCalendar(clock);
          if (year === cal.y && month === cal.m) {
            const inserted = await syncScriptCache(routerId, conn, clock, {
              forDashboard: true,
              skipBackfill: true,
            });
            return { inserted, fetched: 0, skipped: true };
          }
          return { inserted: 0, fetched: 0, skipped: true };
        }
        const row = await getMonthSyncRow(routerId, year, month);
        const lastMik = row?.mikrotikSyncAt?.getTime() ?? 0;
        if (lastMik > 0 && Date.now() - lastMik < REPORT_MONTH_SYNC_GAP_MS) {
          return { inserted: 0, fetched: 0, skipped: true };
        }
      }

      monthSyncedAt.delete(key);
      const { start: monthStart, end: monthEnd } = mikhmonMonthRangeFor(year, month);
      const entries = await fetchScriptSales(
        conn,
        { type: "month", year, month },
        opts?.timeoutMs ?? 90_000,
      );
      const rows = entriesToRows(routerId, entries);
      const { inserted } = await appendMonthScriptSales(routerId, rows, monthStart, monthEnd);
      const totalInDb = await countScriptSalesInMonth(routerId, year, month);
      await upsertMonthSyncRecord(routerId, year, month, totalInDb, {
        mikrotikSync: true,
        verified: false,
      });
      monthSyncedAt.set(key, Date.now());
      invalidateVendorPeriodAggCache(routerId);
      logger.info(
        { routerId, year, month, fetched: entries.length, inserted, totalInDb },
        "script cache: mois rapport aligné sur MikroTik",
      );
      return { inserted, fetched: entries.length, skipped: false };
    } catch (err) {
      logger.warn({ routerId, year, month, err }, "script cache: sync mois rapport échouée (cache local conservé)");
      return { inserted: 0, fetched: 0, skipped: true };
    }
  })().finally(() => {
    monthReportSyncInFlight.delete(key);
  });

  monthReportSyncInFlight.set(key, promise);
  return promise;
}

/** Fin de mois routeur : dernier pull MikroTik du mois précédent avant marquage « vérifié ». */
async function sealPreviousCalendarMonth(
  routerId: number,
  conn: RouterConnection,
  cal: MikhmonCalendar,
): Promise<void> {
  const prev = new Date(cal.y, cal.m - 2, 1);
  const py = prev.getFullYear();
  const pm = prev.getMonth() + 1;
  const row = await getMonthSyncRow(routerId, py, pm);
  if (row?.verifiedAt) return;

  await ensureMonthSalesSyncedFromMikrotik(routerId, conn, py, pm, {
    force: true,
    timeoutMs: 120_000,
  });

  const cnt = await countScriptSalesInMonth(routerId, py, pm);
  if (cnt === 0 && !row) return;
  await upsertMonthSyncRecord(routerId, py, pm, cnt, {
    verified: true,
    mikrotikSync: true,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers existants — inchangés
// ────────────────────────────────────────────────────────────────────────────

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
