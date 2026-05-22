import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { usePageVisibility } from "@/hooks/use-page-visibility";
import {
  isPriorityCacheDisplayable,
  mergePrioritySnapshots,
  readPriorityCache,
  writePriorityCache,
  type PrioritySnapshot,
} from "@/lib/dashboard-priority";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * Même flux temps réel que la carte « Vendu aujourd'hui » du tableau de bord :
 * SSE dashboard-priority + repli HTTP + cache localStorage par routeur (style MikHmon).
 */
export function useRouterDashboardPriority(routerId: number | null) {
  const { token: authToken } = useAuth();
  const isVisible = usePageVisibility();
  const [ssePriority, setSsePriority] = useState<PrioritySnapshot | null>(null);
  const [sseConnected, setSseConnected] = useState(false);

  // Affichage instantané au changement de routeur : dernières valeurs connues.
  useEffect(() => {
    const seed = readPriorityCache(routerId);
    setSsePriority(isPriorityCacheDisplayable(seed) ? seed : null);
    setSseConnected(false);
  }, [routerId]);

  const {
    data: httpPriority,
    isFetching: priorityQueryFetching,
    isLoading: priorityLoading,
    dataUpdatedAt: priorityUpdatedAt,
    refetch: refetchPriority,
    isError: priorityIsError,
    errorUpdatedAt: priorityErrorUpdatedAt,
  } = useQuery<PrioritySnapshot>({
    queryKey: ["router-dashboard-priority", routerId],
    queryFn: async ({ signal }) => {
      const res = await fetch(`${BASE}/api/routers/${routerId}/dashboard-priority`, { signal });
      if (!res.ok) throw new Error("dashboard priority unavailable");
      return res.json() as Promise<PrioritySnapshot>;
    },
    enabled: isVisible && !!routerId,
    refetchInterval: (sseConnected || !isVisible) ? false : 20_000,
    refetchIntervalInBackground: false,
    staleTime: 10_000,
    retry: false,
    throwOnError: false,
    placeholderData: () => readPriorityCache(routerId) ?? undefined,
    initialData: () => readPriorityCache(routerId) ?? undefined,
    initialDataUpdatedAt: () => readPriorityCache(routerId)?.serverTs,
    refetchOnMount: "always",
  });

  useEffect(() => {
    if (!routerId || !authToken || !isVisible) {
      setSseConnected(false);
      return;
    }
    const tokenParam = `?token=${encodeURIComponent(authToken)}`;
    const es = new EventSource(`${BASE}/api/routers/${routerId}/dashboard-priority/stream${tokenParam}`);
    es.onopen = () => setSseConnected(true);
    const onPriority = (ev: MessageEvent) => {
      try {
        const payload = JSON.parse(ev.data) as PrioritySnapshot;
        setSsePriority(payload);
        writePriorityCache(routerId, payload);
      } catch {
        /* polling fallback */
      }
    };
    es.addEventListener("priority", onPriority as EventListener);
    es.onerror = () => setSseConnected(false);
    return () => {
      es.removeEventListener("priority", onPriority as EventListener);
      es.close();
      setSseConnected(false);
    };
  }, [routerId, authToken, isVisible]);

  const livePriority = mergePrioritySnapshots(httpPriority, ssePriority, sseConnected, routerId);

  useEffect(() => {
    if (!routerId || !livePriority) return;
    writePriorityCache(routerId, livePriority);
  }, [routerId, livePriority]);

  const sales = livePriority?.sales;
  const salesKpiReady =
    !!routerId &&
    !!sales &&
    sales._cachedAt != null &&
    (livePriority?.availability?.salesKnown === true || livePriority?.availability == null);

  const rankingReady =
    !!routerId &&
    Array.isArray(livePriority?.vendorRanking) &&
    (livePriority?.availability?.vendorRankingKnown === true || livePriority?.availability == null);

  const liveSnapshotAgeMs = livePriority?.serverTs ? Date.now() - livePriority.serverTs : null;
  const isLiveSnapshotStale = liveSnapshotAgeMs != null && liveSnapshotAgeMs > 10_000;
  const salesFetching = (!sseConnected || isLiveSnapshotStale) && priorityQueryFetching;

  return {
    livePriority,
    sales,
    salesKpiReady,
    rankingReady,
    salesFetching,
    sseConnected,
    priorityLoading,
    priorityUpdatedAt,
    priorityQueryFetching,
    liveSnapshotAgeMs,
    refetchPriority,
    priorityIsError,
    priorityErrorUpdatedAt,
  };
}
