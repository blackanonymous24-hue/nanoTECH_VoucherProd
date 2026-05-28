import { queryClient } from "@/lib/queryClient";
import {
  DASHBOARD_FRESH_MAX_AGE_MS,
  readPriorityCache,
} from "@/lib/dashboard-priority";
import { prefetchRouterDashboardPriority } from "@/lib/prefetch-router-dashboard-priority";
import { clearRouterScopedClientCaches } from "@/lib/router-client-cache";

/** Émis par SessionLifecycle quand l’API reprend (onglet visible / APK premier plan). */
export const VOUCHERNET_APP_RESUME_EVENT = "vouchernet-app-resume";

/**
 * Ouvre la « barrière fraîcheur » AVANT tout prefetch — le tableau de bord reste en
 * skeleton jusqu’à la fin d’un fetch client postérieur à cet instant.
 */
export const VOUCHERNET_DASHBOARD_FRESH_GATE_EVENT = "vouchernet-dashboard-fresh-gate";

/** Relâche la barrière fraîcheur (routeur injoignable — ne pas bloquer sur skeleton). */
export const VOUCHERNET_DASHBOARD_RELEASE_GATE_EVENT = "vouchernet-dashboard-release-gate";

export function notifyAppResume(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(VOUCHERNET_APP_RESUME_EVENT));
}

export function openDashboardFreshGate(routerId: number | null): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(VOUCHERNET_DASHBOARD_FRESH_GATE_EVENT, { detail: { routerId } }),
  );
}

export function releaseDashboardFreshGate(routerId: number | null): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(VOUCHERNET_DASHBOARD_RELEASE_GATE_EVENT, { detail: { routerId } }),
  );
}

export function readSelectedRouterIdFromStorage(): number | null {
  try {
    const raw = localStorage.getItem("vouchernet_router_id");
    const id = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(id) ? id : null;
  } catch {
    return null;
  }
}

/** Recharge KPI dashboard après pause API (même politique que changement de routeur). */
export async function refreshDashboardDataOnResume(routerId: number): Promise<void> {
  openDashboardFreshGate(routerId);
  const cached = readPriorityCache(routerId);
  const cachedAgeMs = cached?.serverTs ? Date.now() - cached.serverTs : Infinity;
  if (cachedAgeMs > DASHBOARD_FRESH_MAX_AGE_MS) {
    clearRouterScopedClientCaches(routerId);
  }
  await queryClient.resetQueries({
    queryKey: ["router-dashboard-priority", routerId],
    exact: true,
  });
  await prefetchRouterDashboardPriority(routerId, { fresh: true });
}
