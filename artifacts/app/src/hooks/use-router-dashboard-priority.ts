import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { usePageVisibility } from "@/hooks/use-page-visibility";
import {
  DASHBOARD_FRESH_MAX_AGE_MS,
  isPriorityCacheDisplayable,
  mergePrioritySnapshots,
  readPriorityCache,
  writePriorityCache,
  type PrioritySnapshot,
} from "@/lib/dashboard-priority";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function snapshotValidForSwitch(
  snapshot: PrioritySnapshot | null | undefined,
  switchStartedAt: number,
): snapshot is PrioritySnapshot {
  if (!snapshot || typeof snapshot.serverTs !== "number") return false;
  return snapshot.serverTs >= switchStartedAt - 800;
}

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
  const switchStartedAtRef = useRef(0);

  if (routerId !== prevRouterIdRef.current) {
    switchStartedAtRef.current = Date.now();
    prevRouterIdRef.current = routerId;
  }

  useLayoutEffect(() => {
    setSsePriority(null);
    setSseConnected(false);
  }, [routerId]);

  const switchStartedAt = switchStartedAtRef.current;

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
        if (!snapshotValidForSwitch(payload, switchStartedAtRef.current)) return;
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

  const httpForMerge = snapshotValidForSwitch(httpPriority, switchStartedAt)
    ? httpPriority
    : undefined;
  const sseForMerge = snapshotValidForSwitch(ssePriority, switchStartedAt)
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
    if (!snapshotValidForSwitch(cached, switchStartedAt)) return null;
    return isPriorityCacheDisplayable(cached) ? cached : null;
  }, [routerId, switchStartedAt, httpForMerge, sseForMerge]);

  const displayPriority = livePriority ?? cacheFallback;

  useEffect(() => {
    if (!routerId || !displayPriority) return;
    if (!snapshotValidForSwitch(displayPriority, switchStartedAtRef.current)) return;
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
  const awaitingRouterSwitch =
    !!routerId && !displayPriority && (priorityLoading || priorityQueryFetching);
  const salesFetching =
    awaitingRouterSwitch || ((!sseConnected || isLiveSnapshotStale) && priorityQueryFetching);

  return {
    livePriority: displayPriority,
    sales,
    salesKpiReady,
    rankingReady,
    salesFetching,
    sseConnected,
    priorityLoading: priorityLoading || awaitingRouterSwitch,
    priorityUpdatedAt,
    priorityQueryFetching,
    liveSnapshotAgeMs,
    refetchPriority,
    priorityIsError,
    priorityErrorUpdatedAt,
    awaitingRouterSwitch,
  };
}
