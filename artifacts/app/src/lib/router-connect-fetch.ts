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

/**
 * Connexion routeur style MikHmon : un fetch API bloquant (fresh+wait).
 * Succès → en ligne + données prêtes. Échec → hors ligne (pas de ping ×3).
 */
export async function fetchRouterForConnect(routerId: number): Promise<boolean> {
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
