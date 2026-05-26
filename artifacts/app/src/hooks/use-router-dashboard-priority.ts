import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { usePageVisibility } from "@/hooks/use-page-visibility";
import {
  DASHBOARD_FRESH_MAX_AGE_MS,
  isPriorityCacheDisplayable,
  mergePrioritySnapshots,
  readPriorityCache,
  snapshotValidForFreshEpoch,
  writePriorityCache,
  type PrioritySnapshot,
} from "@/lib/dashboard-priority";
import { VOUCHERNET_APP_RESUME_EVENT } from "@/lib/dashboard-resume";

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

  const prevRouterIdRef = useRef<number | null>(null);
  const freshnessEpochRef = useRef(0);

  const bumpFreshnessEpoch = useCallback(() => {
    freshnessEpochRef.current = Date.now();
    setSsePriority(null);
    setSseConnected(false);
  }, []);

  if (routerId !== prevRouterIdRef.current) {
    freshnessEpochRef.current = Date.now();
    prevRouterIdRef.current = routerId;
  }

  useLayoutEffect(() => {
    setSsePriority(null);
    setSseConnected(false);
  }, [routerId]);

  useEffect(() => {
    const onAppResume = () => {
      if (!routerId) return;
      bumpFreshnessEpoch();
    };
    window.addEventListener(VOUCHERNET_APP_RESUME_EVENT, onAppResume);
    return () => window.removeEventListener(VOUCHERNET_APP_RESUME_EVENT, onAppResume);
  }, [routerId, bumpFreshnessEpoch]);

  const freshnessEpoch = freshnessEpochRef.current;

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
      const res = await fetch(
        `${BASE}/api/routers/${routerId}/dashboard-priority?fresh=1`,
        { signal },
      );
      if (!res.ok) throw new Error("dashboard priority unavailable");
      return res.json() as Promise<PrioritySnapshot>;
    },
    enabled: isVisible && !!routerId,
    refetchInterval: (sseConnected || !isVisible) ? false : 20_000,
    refetchIntervalInBackground: false,
    staleTime: 10_000,
    retry: false,
    throwOnError: false,
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
        if (!snapshotValidForFreshEpoch(payload, freshnessEpochRef.current)) return;
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

  const httpForMerge = snapshotValidForFreshEpoch(httpPriority, freshnessEpoch)
    ? httpPriority
    : undefined;
  const sseForMerge = snapshotValidForFreshEpoch(ssePriority, freshnessEpoch)
    ? ssePriority
    : null;

  const livePriority = useMemo(
    () => mergePrioritySnapshots(httpForMerge, sseForMerge, sseConnected, routerId, {
      skipCacheMerge: true,
    }),
    [httpForMerge, sseForMerge, sseConnected, routerId],
  );

  const cacheFallback = useMemo(() => {
    if (!routerId) return null;
    const cached = readPriorityCache(routerId);
    if (!snapshotValidForFreshEpoch(cached, freshnessEpoch)) return null;
    return isPriorityCacheDisplayable(cached) ? cached : null;
  }, [routerId, freshnessEpoch, httpForMerge, sseForMerge]);

  const displayPriority = livePriority ?? cacheFallback;

  useEffect(() => {
    if (!routerId || !displayPriority) return;
    if (!snapshotValidForFreshEpoch(displayPriority, freshnessEpochRef.current)) return;
    writePriorityCache(routerId, displayPriority);
  }, [routerId, displayPriority]);

  const sales = displayPriority?.sales;
  const salesKpiReady =
    !!routerId &&
    !!sales &&
    sales._cachedAt != null &&
    (displayPriority?.availability?.salesKnown === true || displayPriority?.availability == null);

  const rankingReady =
    !!routerId &&
    Array.isArray(displayPriority?.vendorRanking) &&
    (displayPriority?.availability?.vendorRankingKnown === true || displayPriority?.availability == null);

  const liveSnapshotAgeMs = displayPriority?.serverTs ? Date.now() - displayPriority.serverTs : null;
  const isLiveSnapshotStale = liveSnapshotAgeMs != null && liveSnapshotAgeMs > DASHBOARD_FRESH_MAX_AGE_MS;
  const awaitingFreshData =
    !!routerId && !displayPriority && (priorityLoading || priorityQueryFetching);
  const salesFetching =
    awaitingFreshData || ((!sseConnected || isLiveSnapshotStale) && priorityQueryFetching);

  return {
    livePriority: displayPriority,
    sales,
    salesKpiReady,
    rankingReady,
    salesFetching,
    sseConnected,
    priorityLoading: priorityLoading || awaitingFreshData,
    priorityUpdatedAt,
    priorityQueryFetching,
    liveSnapshotAgeMs,
    refetchPriority,
    priorityIsError,
    priorityErrorUpdatedAt,
    awaitingRouterSwitch: awaitingFreshData,
    awaitingFreshData,
  };
}
