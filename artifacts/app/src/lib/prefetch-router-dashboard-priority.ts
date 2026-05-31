import { queryClient } from "@/lib/queryClient";
import {
  DASHBOARD_FRESH_MAX_AGE_MS,
  mergeKnownPriorityFields,
  readPriorityCache,
  writePriorityCache,
  type PrioritySnapshot,
} from "@/lib/dashboard-priority";
import { prefetchVendorsSalesSummary } from "@/lib/prefetch-vendors-sales-summary";
import { prefetchReportsSummary } from "@/lib/prefetch-reports-summary";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * Préchauffe le snapshot KPI style MikHmon :
 * 1) fast = clients actifs + utilisateurs (réponse ~2–5 s)
 * 2) complet = ventes en arrière-plan
 */
export async function prefetchRouterDashboardPriority(
  routerId: number,
  opts?: { fresh?: boolean; wait?: boolean },
): Promise<PrioritySnapshot | null> {
  const qk = ["router-dashboard-priority", routerId] as const;
  const freshQ = opts?.fresh ? "&fresh=1" : "";
  const waitQ = opts?.wait ? "&wait=1" : "";
  const query = `?fast=1${freshQ}${waitQ}`;

  if (opts?.fresh) {
    // Connexion routeur : jamais réutiliser un snapshot React Query / localStorage existant.
  } else {
    const cached = queryClient.getQueryData<PrioritySnapshot>(qk);
    const cachedAgeMs = cached?.serverTs ? Date.now() - cached.serverTs : Infinity;
    if (
      cached?.availability?.sessionsKnown
      && cached?.availability?.usersKnown
      && cachedAgeMs < DASHBOARD_FRESH_MAX_AGE_MS
    ) {
      return cached;
    }
  }

  let fastSnap: PrioritySnapshot | null = null;

  try {
    const fastRes = await fetch(`${BASE}/api/routers/${routerId}/dashboard-priority${query}`);
    if (fastRes.ok) {
      fastSnap = (await fastRes.json()) as PrioritySnapshot;
      queryClient.setQueryData(qk, fastSnap);
      writePriorityCache(routerId, fastSnap);
    }
  } catch {
    if (!opts?.fresh) {
      fastSnap = readPriorityCache(routerId);
    }
  }

  if (!opts?.wait) {
    void fetch(`${BASE}/api/routers/${routerId}/dashboard-priority${opts?.fresh ? "?fresh=1" : ""}`)
      .then(async (res) => {
        if (!res.ok) return;
        const full = (await res.json()) as PrioritySnapshot;
        const prev = opts?.fresh ? null : (queryClient.getQueryData<PrioritySnapshot>(qk) ?? fastSnap);
        const merged = prev ? mergeKnownPriorityFields(prev, full) : full;
        queryClient.setQueryData(qk, merged);
        writePriorityCache(routerId, merged);
        prefetchReportsSummary(routerId);
        if (merged.vendorRanking?.length) {
          prefetchVendorsSalesSummary(routerId, merged.vendorRanking);
        }
      })
      .catch(() => { /* polling / SSE */ });
  } else {
    void fetch(`${BASE}/api/routers/${routerId}/dashboard-priority?fresh=1`)
      .then(async (res) => {
        if (!res.ok) return;
        const full = (await res.json()) as PrioritySnapshot;
        queryClient.setQueryData(qk, full);
        writePriorityCache(routerId, full);
        prefetchReportsSummary(routerId);
        if (full.vendorRanking?.length) {
          prefetchVendorsSalesSummary(routerId, full.vendorRanking);
        }
      })
      .catch(() => { /* background */ });
  }

  return queryClient.getQueryData<PrioritySnapshot>(qk) ?? fastSnap;
}

/** Préchauffe les KPI rapides de tous les routeurs visibles (barre latérale). */
export function prefetchAllRoutersDashboardKpi(routerIds: number[]): void {
  const unique = [...new Set(routerIds)].slice(0, 16);
  for (const id of unique) {
    void prefetchRouterDashboardPriority(id);
  }
}
