import { queryClient } from "@/lib/queryClient";
import {
  readPriorityCache,
  writePriorityCache,
  type PrioritySnapshot,
} from "@/lib/dashboard-priority";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** Préchauffe le snapshot KPI (style MikHmon) avant l’affichage du tableau de bord. */
export async function prefetchRouterDashboardPriority(routerId: number): Promise<PrioritySnapshot | null> {
  const qk = ["router-dashboard-priority", routerId] as const;
  const cached = queryClient.getQueryData<PrioritySnapshot>(qk);
  if (cached?.availability?.sessionsKnown && cached?.availability?.usersKnown) {
    return cached;
  }

  try {
    const res = await fetch(`${BASE}/api/routers/${routerId}/dashboard-priority`);
    if (!res.ok) return readPriorityCache(routerId);
    const snap = (await res.json()) as PrioritySnapshot;
    queryClient.setQueryData(qk, snap);
    writePriorityCache(routerId, snap);
    return snap;
  } catch {
    return readPriorityCache(routerId);
  }
}
