import { queryClient } from "@/lib/queryClient";
import { prefetchRouterDashboardPriority } from "@/lib/prefetch-router-dashboard-priority";
import { clearRouterScopedClientCaches } from "@/lib/router-client-cache";

/** Émis au logout / déconnexion auto — ferme SSE et annule les requêtes routeur côté client. */
export const VOUCHERNET_CLIENT_DISCONNECT_EVENT = "vouchernet-client-disconnect";

/** Génération / toggle lot : suspend le SSE dashboard KPI pour libérer les slots MikroTik. */
export const VOUCHERNET_ROUTER_MIKROTIK_BUSY_EVENT = "vouchernet-router-mikrotik-busy";

export function notifyRouterMikrotikBusy(routerId: number, busy: boolean): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(VOUCHERNET_ROUTER_MIKROTIK_BUSY_EVENT, {
      detail: { routerId, busy },
    }),
  );
}

/** Émis par SessionLifecycle quand l’API reprend (onglet visible / APK premier plan). */
export const VOUCHERNET_APP_RESUME_EVENT = "vouchernet-app-resume";

/**
 * Ouvre la « barrière fraîcheur » AVANT tout prefetch — le tableau de bord reste en
 * skeleton jusqu’à la fin d’un fetch client postérieur à cet instant.
 */
export const VOUCHERNET_DASHBOARD_FRESH_GATE_EVENT = "vouchernet-dashboard-fresh-gate";

/** Relâche la barrière fraîcheur (routeur injoignable — ne pas bloquer sur skeleton). */
export const VOUCHERNET_DASHBOARD_RELEASE_GATE_EVENT = "vouchernet-dashboard-release-gate";

export function notifyClientDisconnect(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(VOUCHERNET_CLIENT_DISCONNECT_EVENT));
}

export function notifyAppResume(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(VOUCHERNET_APP_RESUME_EVENT));
}

export function openDashboardFreshGate(routerId: number | null, epochMs?: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(VOUCHERNET_DASHBOARD_FRESH_GATE_EVENT, {
      detail: { routerId, epochMs: epochMs ?? Date.now() },
    }),
  );
}

/** Époque de connexion par routeur — aucun cache antérieur ne doit s'afficher. */
const connectEpochByRouter = new Map<number, number>();

/** Ping OK ou clic routeur : purge caches client + barrière jusqu'au fetch MikroTik wait. */
export function beginRouterConnectFreshEpoch(routerId: number): number {
  const epoch = Date.now();
  connectEpochByRouter.set(routerId, epoch);
  clearRouterScopedClientCaches(routerId);
  void queryClient.resetQueries({
    queryKey: ["router-dashboard-priority", routerId],
    exact: true,
  });
  openDashboardFreshGate(routerId, epoch);
  return epoch;
}

export function getRouterConnectFreshEpoch(routerId: number | null): number {
  if (routerId == null) return 0;
  return connectEpochByRouter.get(routerId) ?? 0;
}

export function finishRouterConnectFreshEpoch(routerId: number): void {
  connectEpochByRouter.delete(routerId);
  releaseDashboardFreshGate(routerId);
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

/** Recharge KPI dashboard après pause API — stale-first, sans bloquer l'UI. */
export function refreshDashboardDataOnResume(routerId: number): void {
  void prefetchRouterDashboardPriority(routerId);
}
