import { prefetchRouterDashboardPriority } from "@/lib/prefetch-router-dashboard-priority";
import {
  finishRouterConnectFreshEpoch,
  releaseDashboardFreshGate,
} from "@/lib/dashboard-resume";
import type { PrioritySnapshot } from "@/lib/dashboard-priority";

/** Données MikroTik reçues = routeur joignable (logique MikHmon originel). */
export function isRouterConnectSnapshotValid(snapshot: PrioritySnapshot | null | undefined): boolean {
  if (!snapshot) return false;
  const a = snapshot.availability;
  if (a?.usersKnown || a?.sessionsKnown) return true;
  return snapshot.users?.cachedAt != null;
}

/** Délai MikHmon par tentative : données reçues en < 3 s = en ligne. */
export const MIKHMON_CONNECT_ATTEMPT_TIMEOUT_MS = 3_000;

async function fetchRouterForConnectOnce(routerId: number): Promise<boolean> {
  try {
    const snapshot = await prefetchRouterDashboardPriority(routerId, { fresh: true, wait: true });
    if (!isRouterConnectSnapshotValid(snapshot)) {
      releaseDashboardFreshGate(routerId);
      return false;
    }
    finishRouterConnectFreshEpoch(routerId);
    return true;
  } catch {
    releaseDashboardFreshGate(routerId);
    return false;
  }
}

/**
 * Connexion routeur style MikHmon : fetch API bloquant (fresh+wait).
 * `timeoutMs` = borne client (ex. 3 s sélecteur) ; sans timeout = attente serveur complète.
 */
export async function fetchRouterForConnect(
  routerId: number,
  opts?: { timeoutMs?: number },
): Promise<boolean> {
  const timeoutMs = opts?.timeoutMs;
  if (!timeoutMs || timeoutMs <= 0) {
    return fetchRouterForConnectOnce(routerId);
  }

  const result = await Promise.race([
    fetchRouterForConnectOnce(routerId).then((ok) => ({ ok, timedOut: false as const })),
    new Promise<{ ok: false; timedOut: true }>((resolve) => {
      setTimeout(() => resolve({ ok: false, timedOut: true }), timeoutMs);
    }),
  ]);

  if (result.timedOut) {
    releaseDashboardFreshGate(routerId);
    return false;
  }
  return result.ok;
}

/** Sélecteur : 2 tentatives (3 s max chacune), toast après le 1er échec, puis overlay si 2e échec. */
export const SELECTOR_CONNECT_MAX_ATTEMPTS = 2;

export async function fetchRouterForConnectWithRetries(
  routerId: number,
  onRetry?: (attempt: number) => void,
): Promise<boolean> {
  for (let attempt = 1; attempt <= SELECTOR_CONNECT_MAX_ATTEMPTS; attempt++) {
    const online = await fetchRouterForConnect(routerId, {
      timeoutMs: MIKHMON_CONNECT_ATTEMPT_TIMEOUT_MS,
    });
    if (online) return true;
    if (attempt < SELECTOR_CONNECT_MAX_ATTEMPTS) {
      onRetry?.(attempt);
    }
  }
  return false;
}
