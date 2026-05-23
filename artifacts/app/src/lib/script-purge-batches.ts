/**
 * Suppression des anciens scripts MikHmon par mois calendaire (HTTP),
 * avec pause API et reprise auto si le routeur est injoignable.
 */
import {
  isRouterUnreachableToggle,
  waitForRouterToggle,
} from "@/lib/hotspot-bulk-toggle";
import { setApiRequestPause } from "@/lib/installAuthFetch";

export const SCRIPT_PURGE_ALLOW_PATH_PATTERNS: RegExp[] = [
  /\/api\/admin\/purge-old-sales-scripts(?:$|[/?#])/,
  /\/api\/routers\/\d+\/ping(?:$|[/?#])/,
  /\/api\/routers\/\d+\/generation-lock(?:$|[/?#])/,
];

const SCRIPT_PURGE_MONTH_TIMEOUT_MS = 240_000;
const EMPTY_MONTH_STOP_STREAK = 8;
const MAX_MONTHS = 84;

export type ScriptPurgeProgressState = {
  done: number;
  total: number;
  currentYearMonth?: string;
};

export type ScriptPurgeRunResult = {
  router: { routerId: number; routerName: string; routerHost: string };
  cutoff: string;
  keptMonths: string;
  totalRemoved: number;
  totalFailed: number;
  cacheRowsDeleted: number;
  byMonth: Array<{ yearMonth: string; count: number }>;
  status: "clean" | "partial";
  remaining: number;
};

type ScriptPurgeMonthResponse = {
  cutoff: string;
  keptMonths: string;
  router: { routerId: number; routerName: string; routerHost: string };
  yearMonth?: string;
  done: boolean;
  removed: number;
  failed: number;
  scanned: number;
  remaining: number;
  byMonth: Array<{ yearMonth: string; count: number }>;
  cacheRowsDeleted: number;
};

export function getScriptPurgeCutoff(): { cutoffYear: number; cutoffMonth: number } {
  const now = new Date();
  const cutoffYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const cutoffMonth = now.getMonth() === 0 ? 12 : now.getMonth();
  return { cutoffYear, cutoffMonth };
}

/** Mois strictement avant le 1er jour du mois « cutoff » (conservation : mois courant + précédent). */
export function* monthsBeforeScriptPurgeCutoff(
  cutoffYear: number,
  cutoffMonth: number,
): Generator<{ year: number; month: number }> {
  let y = cutoffYear;
  let m = cutoffMonth - 1;
  if (m < 1) {
    m = 12;
    y -= 1;
  }
  for (let i = 0; i < MAX_MONTHS; i++) {
    if (y < 2018) break;
    yield { year: y, month: m };
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
  }
}

export type RunScriptPurgeOptions = {
  onProgress?: (p: ScriptPurgeProgressState | null) => void;
  onPaused?: (paused: boolean) => void;
};

async function fetchScriptPurgeMonth(
  base: string,
  token: string,
  routerId: number,
  year: number,
  month: number,
): Promise<ScriptPurgeMonthResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    ctrl.abort(new DOMException("Délai dépassé pour ce mois", "AbortError"));
  }, SCRIPT_PURGE_MONTH_TIMEOUT_MS);

  try {
    const res = await fetch(`${base}/api/admin/purge-old-sales-scripts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ routerId, year, month }),
      signal: ctrl.signal,
    });
    const data = (await res.json().catch(() => ({}))) as ScriptPurgeMonthResponse & { error?: string };
    if (!res.ok) {
      throw Object.assign(
        new Error(typeof data.error === "string" && data.error ? data.error : `HTTP ${res.status}`),
        { response: { status: res.status } },
      );
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchScriptPurgeFinalize(
  base: string,
  token: string,
  routerId: number,
): Promise<number> {
  const res = await fetch(`${base}/api/admin/purge-old-sales-scripts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ routerId, finalize: true }),
  });
  const data = (await res.json().catch(() => ({}))) as { cacheRowsDeleted?: number; error?: string };
  if (!res.ok) {
    throw new Error(typeof data.error === "string" ? data.error : `HTTP ${res.status}`);
  }
  return data.cacheRowsDeleted ?? 0;
}

/**
 * Purge mois par mois avec reprise auto (ping routeur) en cas de perte de connexion.
 */
export async function runScriptPurgeWithAutoResume(
  base: string,
  token: string,
  routerId: number,
  options?: RunScriptPurgeOptions,
): Promise<ScriptPurgeRunResult> {
  const onProgress = options?.onProgress;
  const onPaused = options?.onPaused ?? (() => {});

  const { cutoffYear, cutoffMonth } = getScriptPurgeCutoff();
  const months = [...monthsBeforeScriptPurgeCutoff(cutoffYear, cutoffMonth)];
  const total = months.length;

  setApiRequestPause(true, {
    allowPathPatterns: [...SCRIPT_PURGE_ALLOW_PATH_PATTERNS],
    scopeRouterId: routerId,
  });

  onPaused(false);
  onProgress?.({ done: 0, total });

  let totalRemoved = 0;
  let totalFailed = 0;
  const byMonthMap = new Map<string, number>();
  let emptyStreak = 0;
  let doneMonths = 0;
  let meta: Pick<ScriptPurgeRunResult, "router" | "cutoff" | "keptMonths"> | null = null;

  try {
    for (const { year, month } of months) {
      if (emptyStreak >= EMPTY_MONTH_STOP_STREAK) break;

      const ym = `${year}-${String(month).padStart(2, "0")}`;
      onProgress?.({ done: doneMonths, total, currentYearMonth: ym });

      let monthOk = false;
      let unreachableStreak = 0;

      while (!monthOk) {
        try {
          const batch = await fetchScriptPurgeMonth(base, token, routerId, year, month);
          if (!meta) {
            meta = {
              router: batch.router,
              cutoff: batch.cutoff,
              keptMonths: batch.keptMonths,
            };
          }

          totalRemoved += batch.removed;
          totalFailed += batch.failed;
          if (batch.removed > 0) {
            byMonthMap.set(ym, (byMonthMap.get(ym) ?? 0) + batch.removed);
          }

          if (batch.scanned === 0 && batch.removed === 0) {
            emptyStreak += 1;
          } else {
            emptyStreak = 0;
          }

          monthOk = true;
          unreachableStreak = 0;
        } catch (e: unknown) {
          if (isRouterUnreachableToggle(e)) {
            unreachableStreak++;
            if (unreachableStreak === 1) {
              await new Promise<void>((r) => setTimeout(r, 3000));
              continue;
            }
            onPaused(true);
            await waitForRouterToggle(routerId, base);
            onPaused(false);
            unreachableStreak = 0;
          } else {
            throw e;
          }
        }
      }

      doneMonths += 1;
      onProgress?.({ done: doneMonths, total, currentYearMonth: ym });
    }

    const byMonth = Array.from(byMonthMap.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([yearMonth, count]) => ({ yearMonth, count }));

    let cacheRowsDeleted = 0;
    if (totalFailed === 0) {
      try {
        cacheRowsDeleted = await fetchScriptPurgeFinalize(base, token, routerId);
      } catch {
        /* cache optionnel */
      }
    }

    onProgress?.({ done: total, total });

    if (!meta) {
      throw new Error("Aucune réponse routeur");
    }

    return {
      ...meta,
      totalRemoved,
      totalFailed,
      cacheRowsDeleted,
      byMonth,
      status: totalFailed === 0 ? "clean" : "partial",
      remaining: totalFailed,
    };
  } finally {
    setApiRequestPause(false);
    onPaused(false);
    onProgress?.(null);
  }
}
