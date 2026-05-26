import { queryClient } from "@/lib/queryClient";
import {
  DASHBOARD_FRESH_MAX_AGE_MS,
  readPriorityCache,
} from "@/lib/dashboard-priority";
import { prefetchRouterDashboardPriority } from "@/lib/prefetch-router-dashboard-priority";
import { clearRouterScopedClientCaches } from "@/lib/router-client-cache";

/** Émis par SessionLifecycle quand l’API reprend (onglet visible / APK premier plan). */
export const VOUCHERNET_APP_RESUME_EVENT = "vouchernet-app-resume";

export function notifyAppResume(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(VOUCHERNET_APP_RESUME_EVENT));
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
