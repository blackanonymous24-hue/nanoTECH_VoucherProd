import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { usePageVisibility } from "@/hooks/use-page-visibility";
import {
  DASHBOARD_FRESH_MAX_AGE_MS,
  isSnapshotMikrotikFreshAfterEpoch,
  mergePrioritySnapshots,
  writePriorityCache,
  type PrioritySnapshot,
} from "@/lib/dashboard-priority";
import {
  VOUCHERNET_APP_RESUME_EVENT,
  VOUCHERNET_DASHBOARD_FRESH_GATE_EVENT,
  VOUCHERNET_DASHBOARD_RELEASE_GATE_EVENT,
  getRouterConnectFreshEpoch,
  finishRouterConnectFreshEpoch,
} from "@/lib/dashboard-resume";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const KPI_POLL_MS = DASHBOARD_FRESH_MAX_AGE_MS;

/**
 * KPI dashboard : skeleton obligatoire après connexion routeur jusqu'au fetch MikroTik wait.
 */
export function useRouterDashboardPriority(routerId: number | null) {
  const { token: authToken } = useAuth();
  const isVisible = usePageVisibility();
  const [ssePriority, setSsePriority] = useState<PrioritySnapshot | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const [awaitingFresh, setAwaitingFresh] = useState(() => getRouterConnectFreshEpoch(routerId) > 0);
  const [freshEpochMs, setFreshEpochMs] = useState(() => getRouterConnectFreshEpoch(routerId));

  const prevRouterIdRef = useRef<number | null>(routerId);
  const freshEpochRef = useRef(freshEpochMs);
  freshEpochRef.current = freshEpochMs;

  const openFreshGate = useCallback((epochMs?: number) => {
    const epoch = epochMs ?? Date.now();
    setFreshEpochMs(epoch);
    setAwaitingFresh(true);
    setSsePriority(null);
    setSseConnected(false);
  }, []);

  if (routerId !== prevRouterIdRef.current) {
    prevRouterIdRef.current = routerId;
    const epoch = getRouterConnectFreshEpoch(routerId);
    setFreshEpochMs(epoch);
    setAwaitingFresh(epoch > 0);
    setSsePriority(null);
    setSseConnected(false);
  }

  useLayoutEffect(() => {
    if (!routerId) {
      setAwaitingFresh(false);
      setFreshEpochMs(0);
    }
  }, [routerId]);

  useLayoutEffect(() => {
    const onFreshGate = (ev: Event) => {
      const detail = (ev as CustomEvent<{ routerId?: number | null; epochMs?: number }>).detail;
      if (detail?.routerId != null && detail.routerId !== routerId) return;
      openFreshGate(detail?.epochMs);
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

  const tryReleaseFreshGate = useCallback((snapshot: PrioritySnapshot | null | undefined) => {
    if (!routerId || !snapshot) return;
    const epoch = freshEpochRef.current;
    if (epoch > 0 && !isSnapshotMikrotikFreshAfterEpoch(snapshot, epoch)) return;
    setAwaitingFresh(false);
    if (epoch > 0) finishRouterConnectFreshEpoch(routerId);
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
    queryKey: ["router-dashboard-priority", routerId, awaitingFresh ? freshEpochMs : "live"],
    queryFn: async ({ signal }) => {
      const epoch = freshEpochRef.current;
      const needsWait = epoch > 0;
      const q = needsWait ? "?fast=1&fresh=1&wait=1" : "?fast=1";
      const res = await fetch(`${BASE}/api/routers/${routerId}/dashboard-priority${q}`, { signal });
      if (!res.ok) throw new Error("dashboard priority unavailable");
      return res.json() as Promise<PrioritySnapshot>;
    },
    enabled: isVisible && !!routerId,
    refetchInterval: (sseConnected || !isVisible || awaitingFresh) ? false : KPI_POLL_MS,
    refetchIntervalInBackground: false,
    staleTime: KPI_POLL_MS - 1_000,
    gcTime: 5 * 60_000,
    retry: false,
    throwOnError: false,
    structuralSharing: false,
  });

  useEffect(() => {
    if (!awaitingFresh || !routerId || !httpPriority) return;
    tryReleaseFreshGate(httpPriority);
  }, [awaitingFresh, routerId, httpPriority, tryReleaseFreshGate]);

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
        const epoch = freshEpochRef.current;
        if (epoch > 0 && !isSnapshotMikrotikFreshAfterEpoch(payload, epoch)) return;
        setSsePriority(payload);
        writePriorityCache(routerId, payload);
        tryReleaseFreshGate(payload);
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
  }, [routerId, authToken, isVisible, tryReleaseFreshGate]);

  const livePriority = useMemo(
    () => mergePrioritySnapshots(
      httpPriority,
      ssePriority,
      sseConnected,
      routerId,
      { skipCacheMerge: awaitingFresh },
    ),
    [httpPriority, ssePriority, sseConnected, routerId, awaitingFresh],
  );

  useEffect(() => {
    if (!routerId || !livePriority || awaitingFresh) return;
    writePriorityCache(routerId, livePriority);
  }, [routerId, livePriority, awaitingFresh]);

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
  const salesFetching = awaitingFresh && priorityQueryFetching;

  return {
    livePriority: awaitingFresh ? null : livePriority,
    sales: awaitingFresh ? undefined : sales,
    salesKpiReady: awaitingFresh ? false : salesKpiReady,
    rankingReady: awaitingFresh ? false : rankingReady,
    salesFetching,
    sseConnected,
    priorityLoading: (priorityLoading || awaitingFresh) && !livePriority,
    priorityUpdatedAt,
    priorityQueryFetching,
    liveSnapshotAgeMs,
    refetchPriority,
    priorityIsError,
    priorityErrorUpdatedAt,
    awaitingRouterSwitch: awaitingFresh,
    awaitingFreshData: awaitingFresh,
  };
}
