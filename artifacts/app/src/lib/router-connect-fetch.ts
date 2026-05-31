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

/** Borne sécurité fetch connect (refresh KPI MikroTik côté serveur). Le ping TCP reste 3 s. */
export const ROUTER_CONNECT_FETCH_TIMEOUT_MS = 25_000;

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
 * Connexion routeur : fetch API bloquant (fresh+wait).
 * Timeout client = temps max du refresh KPI serveur (pas le ping TCP 3 s).
 */
export async function fetchRouterForConnect(
  routerId: number,
  opts?: { timeoutMs?: number },
): Promise<boolean> {
  const timeoutMs = opts?.timeoutMs ?? ROUTER_CONNECT_FETCH_TIMEOUT_MS;
  if (timeoutMs <= 0) {
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

/** 2 tentatives fetch ; timeout = refresh KPI serveur (~25 s max par essai). */
export const SELECTOR_CONNECT_MAX_ATTEMPTS = 2;

export async function fetchRouterForConnectWithRetries(
  routerId: number,
  onRetry?: (attempt: number) => void,
): Promise<boolean> {
  for (let attempt = 1; attempt <= SELECTOR_CONNECT_MAX_ATTEMPTS; attempt++) {
    const online = await fetchRouterForConnect(routerId);
    if (online) return true;
    if (attempt < SELECTOR_CONNECT_MAX_ATTEMPTS) {
      onRetry?.(attempt);
    }
  }
  return false;
}
