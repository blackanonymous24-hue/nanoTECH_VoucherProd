/**
 * Désactivation / réactivation hotspot par paquets HTTP (verrou routeur, pause API, reprise auto).
 * Utilisé par la page Vouchers et par l’activation / désactivation des vendeurs.
 */
import { setApiRequestPause } from "@/lib/installAuthFetch";

export const TOGGLE_BATCH_THRESHOLD = 50;
export const TOGGLE_BATCH_SIZE = 150;

export type HotspotBulkProgressState = { done: number; total: number; enable: boolean };

export function isRouterUnreachableToggle(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;
  if (e.name === "AbortError") return false;
  const response = e.response as Record<string, unknown> | undefined;
  if (response?.status === 502) return true;
  const msg = String(e.message ?? "").toLowerCase();
  return (
    msg.includes("502") ||
    msg.includes("contacter") ||
    msg.includes("unreachable") ||
    msg.includes("network error") ||
    msg.includes("failed to fetch") ||
    msg.includes("load failed")
  );
}

export async function waitForRouterToggle(routerId: number, base: string): Promise<void> {
  for (;;) {
    await new Promise<void>((r) => setTimeout(r, 4000));
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10_000);
      try {
        const res = await fetch(`${base}/api/routers/${routerId}/ping?force=1`, { signal: ctrl.signal });
        clearTimeout(timer);
        if (res.ok) {
          const data = (await res.json()) as { success: boolean };
          if (data.success) return;
        }
      } finally {
        clearTimeout(timer);
      }
    } catch {
      /* retry */
    }
  }
}

export type RunHotspotUserToggleBatchesOptions = {
  /** Par défaut : total >= TOGGLE_BATCH_THRESHOLD */
  showProgress?: boolean;
  onProgress?: (p: HotspotBulkProgressState | null) => void;
  onPaused?: (paused: boolean) => void;
};

/**
 * Pour chaque routeur : verrou, puis requêtes /users-toggle par tranches.
 * `enable === true` = réactivation (tickets non vendus du vendeur / sélection).
 */
export async function runHotspotUserToggleBatches(
  base: string,
  plans: Array<{ routerId: number; usernames: string[] }>,
  enable: boolean,
  options?: RunHotspotUserToggleBatchesOptions,
): Promise<void> {
  const plansFiltered = plans
    .map((p) => ({ routerId: p.routerId, usernames: p.usernames.filter((u) => u?.trim()) }))
    .filter((p) => p.usernames.length > 0);
  const total = plansFiltered.reduce((s, p) => s + p.usernames.length, 0);
  if (total === 0) return;

  const showProgress = options?.showProgress ?? total >= TOGGLE_BATCH_THRESHOLD;
  const onProgress = options?.onProgress;
  const onPaused = options?.onPaused ?? (() => {});

  setApiRequestPause(true, {
    allowPathPatterns: [
      /\/api\/vouchers\/users-toggle(?:$|[/?#])/,
      /\/api\/vouchers\/lot-usernames(?:$|[/?#])/,
      /\/api\/vouchers\/lot-disable(?:$|[/?#])/,
      /\/api\/routers\/\d+\/generation-lock(?:$|[/?#])/,
      /\/api\/routers\/\d+\/ping(?:$|[/?#])/,
      /\/api\/routers\/\d+\/users(?:$|[/?#])/,
    ],
  });

  if (showProgress) {
    onPaused(false);
    onProgress?.({ done: 0, total, enable });
  }

  let doneAll = 0;

  try {
    for (const { routerId, usernames } of plansFiltered) {
      let lockAcquired = false;
      try {
        const lockResp = await fetch(`${base}/api/routers/${routerId}/generation-lock`, { method: "POST" });
        if (!lockResp.ok) {
          const reason = await lockResp.text().catch(() => "");
          throw new Error(reason || "Impossible d'obtenir le verrou routeur (opération en cours ?).");
        }
        lockAcquired = true;

        let offset = 0;
        while (offset < usernames.length) {
          const slice = usernames.slice(offset, offset + TOGGLE_BATCH_SIZE);
          let batchOk = false;
          let unreachableStreak = 0;
          while (!batchOk) {
            try {
              const res = await fetch(`${base}/api/vouchers/users-toggle`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ routerId, usernames: slice, enable }),
              });
              if (!res.ok) {
                const err = Object.assign(new Error(`HTTP ${res.status}`), { response: { status: res.status } });
                throw err;
              }
              offset += slice.length;
              doneAll += slice.length;
              if (showProgress) {
                onProgress?.({ done: doneAll, total, enable });
              }
              batchOk = true;
              unreachableStreak = 0;
            } catch (e: unknown) {
              if (isRouterUnreachableToggle(e)) {
                unreachableStreak++;
                if (unreachableStreak === 1) {
                  await new Promise<void>((r) => setTimeout(r, 3000));
                  continue;
                }
                if (showProgress) onPaused(true);
                await waitForRouterToggle(routerId, base);
                if (showProgress) onPaused(false);
                unreachableStreak = 0;
              } else {
                throw e;
              }
            }
          }
        }
      } finally {
        if (lockAcquired) {
          void fetch(`${base}/api/routers/${routerId}/generation-lock`, { method: "DELETE" });
        }
      }
    }
  } finally {
    setApiRequestPause(false);
    if (showProgress) {
      onProgress?.(null);
      onPaused(false);
    }
  }
}
