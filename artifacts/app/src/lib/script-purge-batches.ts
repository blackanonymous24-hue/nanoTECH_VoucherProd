/**
 * Purge scripts MikHmon par lots de 200 (progression scripts supprimés / total),
 * reprise auto si le routeur est injoignable.
 */
import {
  isRouterUnreachableToggle,
  waitForRouterToggle,
} from "@/lib/hotspot-bulk-toggle";
import { setApiRequestPause } from "@/lib/installAuthFetch";

export const SCRIPT_PURGE_BATCH_SIZE = 200;
export const SCRIPT_PURGE_ALLOW_PATH_PATTERNS: RegExp[] = [
  /\/api\/admin\/purge-old-sales-scripts(?:$|[/?#])/,
  /\/api\/routers\/\d+\/ping(?:$|[/?#])/,
  /\/api\/routers\/\d+\/generation-lock(?:$|[/?#])/,
];

const SCRIPT_PURGE_REQUEST_TIMEOUT_MS = 200_000;
const SCRIPT_PURGE_MAX_RETRIES = 3;

export type ScriptPurgeProgressState = {
  done: number;
  total: number;
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

type ScriptPurgeBatchResponse = {
  cutoff: string;
  keptMonths: string;
  router: { routerId: number; routerName: string; routerHost: string };
  batchSize: number;
  done: boolean;
  removed: number;
  failed: number;
  scanned: number;
  remaining: number;
  totalCandidates?: number;
  byMonth: Array<{ yearMonth: string; count: number }>;
  cacheRowsDeleted: number;
  nextCursor?: { year: number; month: number } | null;
  purgeComplete?: boolean;
};

export type RunScriptPurgeOptions = {
  onProgress?: (p: ScriptPurgeProgressState | null) => void;
  onPaused?: (paused: boolean) => void;
};

async function fetchScriptPurge(
  base: string,
  token: string,
  body: Record<string, unknown>,
): Promise<ScriptPurgeBatchResponse> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= SCRIPT_PURGE_MAX_RETRIES; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      ctrl.abort(new DOMException("Délai dépassé", "AbortError"));
    }, SCRIPT_PURGE_REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${base}/api/admin/purge-old-sales-scripts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const data = (await res.json().catch(() => ({}))) as ScriptPurgeBatchResponse & { error?: string };
      if (!res.ok) {
        throw Object.assign(
          new Error(typeof data.error === "string" && data.error ? data.error : `HTTP ${res.status}`),
          { response: { status: res.status } },
        );
      }
      return data;
    } catch (e) {
      lastErr = e;
      if (attempt < SCRIPT_PURGE_MAX_RETRIES && isRouterUnreachableToggle(e)) {
        await new Promise<void>((r) => setTimeout(r, 400 + attempt * 500));
        continue;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/**
 * Lots de {@link SCRIPT_PURGE_BATCH_SIZE} scripts — barre `supprimés / total`, rapide côté routeur.
 */
export async function runScriptPurgeWithAutoResume(
  base: string,
  token: string,
  routerId: number,
  options?: RunScriptPurgeOptions,
): Promise<ScriptPurgeRunResult> {
  const onProgress = options?.onProgress;
  const onPaused = options?.onPaused ?? (() => {});

  setApiRequestPause(true, {
    allowPathPatterns: [...SCRIPT_PURGE_ALLOW_PATH_PATTERNS],
    scopeRouterId: routerId,
  });

  onPaused(false);

  let totalRemoved = 0;
  let totalFailed = 0;
  const byMonthMap = new Map<string, number>();
  let total = 0;
  let meta: Pick<ScriptPurgeRunResult, "router" | "cutoff" | "keptMonths"> | null = null;
  let cursor: { year: number; month: number } | null | undefined = undefined;
  let lastRemaining = 0;
  let cleanFinish = false;

  try {
    const estimate = await fetchScriptPurge(base, token, { routerId, estimate: true });
    meta = {
      router: estimate.router,
      cutoff: estimate.cutoff,
      keptMonths: estimate.keptMonths,
    };
    total = Math.max(0, estimate.totalCandidates ?? estimate.remaining ?? estimate.scanned ?? 0);
    onProgress?.({ done: 0, total: Math.max(total, 1) });

    for (;;) {
      let batch: ScriptPurgeBatchResponse | null = null;
      let unreachableStreak = 0;

      while (!batch) {
        try {
          batch = await fetchScriptPurge(base, token, {
            routerId,
            batchSize: SCRIPT_PURGE_BATCH_SIZE,
            ...(cursor != null ? { cursor } : {}),
          });
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

      totalRemoved += batch.removed;
      totalFailed += batch.failed;
      lastRemaining = batch.remaining;
      for (const m of batch.byMonth) {
        byMonthMap.set(m.yearMonth, (byMonthMap.get(m.yearMonth) ?? 0) + m.count);
      }

      total = Math.max(total, totalRemoved + lastRemaining, totalRemoved);
      onProgress?.({
        done: Math.min(totalRemoved, total),
        total: Math.max(total, totalRemoved, 1),
      });

      if (batch.done) {
        cleanFinish = true;
        break;
      }
      if (batch.purgeComplete) break;
      if (batch.removed === 0 && !batch.nextCursor) break;

      cursor = batch.nextCursor ?? null;
    }

    const byMonth = Array.from(byMonthMap.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([yearMonth, count]) => ({ yearMonth, count }));

    onProgress?.({ done: totalRemoved, total: Math.max(total, totalRemoved, 1) });

    if (!meta) throw new Error("Aucune réponse routeur");

    return {
      ...meta,
      totalRemoved,
      totalFailed,
      cacheRowsDeleted: 0,
      byMonth,
      status: cleanFinish && totalFailed === 0 ? "clean" : "partial",
      remaining: totalFailed > 0 ? totalFailed : lastRemaining,
    };
  } finally {
    setApiRequestPause(false);
    onPaused(false);
    onProgress?.(null);
  }
}
