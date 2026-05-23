import { queryClient } from "@/lib/queryClient";
import {
  mergeKnownPriorityFields,
  readPriorityCache,
  writePriorityCache,
  type PrioritySnapshot,
} from "@/lib/dashboard-priority";
import { prefetchVendorsSalesSummary } from "@/lib/prefetch-vendors-sales-summary";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * Préchauffe le snapshot KPI style MikHmon :
 * 1) fast = clients actifs + utilisateurs (réponse ~2–5 s)
 * 2) complet = ventes en arrière-plan
 */
export async function prefetchRouterDashboardPriority(routerId: number): Promise<PrioritySnapshot | null> {
  const qk = ["router-dashboard-priority", routerId] as const;
  const cached = queryClient.getQueryData<PrioritySnapshot>(qk);
  if (cached?.availability?.sessionsKnown && cached?.availability?.usersKnown) {
    return cached;
  }

  let fastSnap: PrioritySnapshot | null = null;

  try {
    const fastRes = await fetch(`${BASE}/api/routers/${routerId}/dashboard-priority?fast=1`);
    if (fastRes.ok) {
      fastSnap = (await fastRes.json()) as PrioritySnapshot;
      const prev = queryClient.getQueryData<PrioritySnapshot>(qk);
      const merged = prev?.availability?.salesKnown
        ? mergeKnownPriorityFields(fastSnap, prev)
        : fastSnap;
      queryClient.setQueryData(qk, merged);
      writePriorityCache(routerId, merged);
    }
  } catch {
    fastSnap = readPriorityCache(routerId);
  }

  void fetch(`${BASE}/api/routers/${routerId}/dashboard-priority`)
    .then(async (res) => {
      if (!res.ok) return;
      const full = (await res.json()) as PrioritySnapshot;
      const prev = queryClient.getQueryData<PrioritySnapshot>(qk) ?? fastSnap;
      const merged = prev ? mergeKnownPriorityFields(prev, full) : full;
      queryClient.setQueryData(qk, merged);
      writePriorityCache(routerId, merged);
      if (merged.vendorRanking?.length) {
        prefetchVendorsSalesSummary(routerId, merged.vendorRanking);
      }
    })
    .catch(() => { /* polling / SSE */ });

  return queryClient.getQueryData<PrioritySnapshot>(qk) ?? fastSnap ?? readPriorityCache(routerId);
}

/** Préchauffe les KPI rapides de tous les routeurs visibles (barre latérale). */
export function prefetchAllRoutersDashboardKpi(routerIds: number[]): void {
  const unique = [...new Set(routerIds)].slice(0, 16);
  for (const id of unique) {
    void prefetchRouterDashboardPriority(id);
  }
}
