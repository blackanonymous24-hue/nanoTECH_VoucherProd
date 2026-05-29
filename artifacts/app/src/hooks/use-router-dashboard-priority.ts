import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import {
  VOUCHERNET_APP_RESUME_EVENT,
  VOUCHERNET_DASHBOARD_FRESH_GATE_EVENT,
  VOUCHERNET_DASHBOARD_RELEASE_GATE_EVENT,
} from "@/lib/dashboard-resume";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const KPI_POLL_MS = DASHBOARD_FRESH_MAX_AGE_MS;

function shouldBlockOnFreshGate(routerId: number | null): boolean {
  if (!routerId) return false;
  const cached = readPriorityCache(routerId);
  if (!isPriorityCacheDisplayable(cached)) return true;
  const ageMs = cached?.serverTs ? Date.now() - cached.serverTs : Infinity;
  return ageMs > DASHBOARD_FRESH_MAX_AGE_MS;
}

/**
 * KPI dashboard style MikHmon : affichage instantané (cache stale), refresh ≤ 10 s via SSE + poll.
 */
export function useRouterDashboardPriority(routerId: number | null) {
  const { token: authToken } = useAuth();
  const isVisible = usePageVisibility();
  const [ssePriority, setSsePriority] = useState<PrioritySnapshot | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const [awaitingFresh, setAwaitingFresh] = useState(() => shouldBlockOnFreshGate(routerId));

  const prevRouterIdRef = useRef<number | null>(routerId);

  const openFreshGate = useCallback(() => {
    setAwaitingFresh(shouldBlockOnFreshGate(routerId));
    if (shouldBlockOnFreshGate(routerId)) {
      setSsePriority(null);
      setSseConnected(false);
    }
  }, [routerId]);

  if (routerId !== prevRouterIdRef.current) {
    prevRouterIdRef.current = routerId;
    setAwaitingFresh(shouldBlockOnFreshGate(routerId));
    setSsePriority(null);
    setSseConnected(false);
  }

  useLayoutEffect(() => {
    if (!routerId) setAwaitingFresh(false);
  }, [routerId]);

  useLayoutEffect(() => {
    const onFreshGate = (ev: Event) => {
      const detail = (ev as CustomEvent<{ routerId?: number | null }>).detail;
      if (detail?.routerId != null && detail.routerId !== routerId) return;
      openFreshGate();
    };
    const onReleaseGate = (ev: Event) => {
      const detail = (ev as CustomEvent<{ routerId?: number | null }>).detail;
      if (detail?.routerId != null && detail.routerId !== routerId) return;
      setAwaitingFresh(false);
    };
    const onAppResume = () => {
      if (!routerId) return;
      openFreshGate();
    };
    window.addEventListener(VOUCHERNET_DASHBOARD_FRESH_GATE_EVENT, onFreshGate);
    window.addEventListener(VOUCHERNET_DASHBOARD_RELEASE_GATE_EVENT, onReleaseGate);
    window.addEventListener(VOUCHERNET_APP_RESUME_EVENT, onAppResume);
    return () => {
      window.removeEventListener(VOUCHERNET_DASHBOARD_FRESH_GATE_EVENT, onFreshGate);
      window.removeEventListener(VOUCHERNET_DASHBOARD_RELEASE_GATE_EVENT, onReleaseGate);
      window.removeEventListener(VOUCHERNET_APP_RESUME_EVENT, onAppResume);
    };
  }, [routerId, openFreshGate]);

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
        `${BASE}/api/routers/${routerId}/dashboard-priority?fast=1`,
        { signal },
      );
      if (!res.ok) throw new Error("dashboard priority unavailable");
      return res.json() as Promise<PrioritySnapshot>;
    },
    enabled: isVisible && !!routerId,
    refetchInterval: (sseConnected || !isVisible) ? false : KPI_POLL_MS,
    refetchIntervalInBackground: false,
    staleTime: KPI_POLL_MS - 1_000,
    gcTime: 5 * 60_000,
    retry: false,
    throwOnError: false,
    structuralSharing: false,
  });

  useEffect(() => {
    if (!awaitingFresh || !routerId) return;
    if (httpPriority && priorityUpdatedAt > 0) setAwaitingFresh(false);
  }, [awaitingFresh, routerId, httpPriority, priorityUpdatedAt]);

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
        setAwaitingFresh(false);
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

  const livePriority = useMemo(
    () => mergePrioritySnapshots(httpPriority, ssePriority, sseConnected, routerId),
    [httpPriority, ssePriority, sseConnected, routerId],
  );

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
  const salesFetching = awaitingFresh && !httpPriority && priorityQueryFetching;

  return {
    livePriority,
    sales,
    salesKpiReady,
    rankingReady,
    salesFetching,
    sseConnected,
    priorityLoading: priorityLoading && !livePriority,
    priorityUpdatedAt,
    priorityQueryFetching,
    liveSnapshotAgeMs,
    refetchPriority,
    priorityIsError,
    priorityErrorUpdatedAt,
    awaitingRouterSwitch: awaitingFresh && !livePriority,
    awaitingFreshData: awaitingFresh && !livePriority,
  };
}
