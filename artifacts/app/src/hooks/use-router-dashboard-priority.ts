import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { usePageVisibility } from "@/hooks/use-page-visibility";
import {
  DASHBOARD_FRESH_MAX_AGE_MS,
  isPriorityCacheDisplayable,
  isPriorityInfoDisplayable,
  isPrioritySnapshotFreshForSwitch,
  isSnapshotMikrotikFreshAfterEpoch,
  mergePrioritySnapshots,
  readPriorityCacheForDisplay,
  ROUTER_SWITCH_FRESH_MAX_AGE_MS,
  writePriorityCache,
  type PrioritySnapshot,
} from "@/lib/dashboard-priority";
import {
  VOUCHERNET_APP_RESUME_EVENT,
  VOUCHERNET_CLIENT_DISCONNECT_EVENT,
  VOUCHERNET_DASHBOARD_FRESH_GATE_EVENT,
  VOUCHERNET_DASHBOARD_RELEASE_GATE_EVENT,
  getRouterConnectFreshEpoch,
  finishRouterConnectFreshEpoch,
} from "@/lib/dashboard-resume";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const KPI_POLL_MS = DASHBOARD_FRESH_MAX_AGE_MS;

/**
 * KPI dashboard : stale-first au retour onglet ; skeleton au switch routeur tant que
 * snapshot < 2 min indisponible ; gate strict uniquement après beginRouterConnectFreshEpoch.
 */
export function useRouterDashboardPriority(routerId: number | null) {
  const { token: authToken } = useAuth();
  const isVisible = usePageVisibility();
  const [ssePriority, setSsePriority] = useState<PrioritySnapshot | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const connectEpoch = routerId != null ? getRouterConnectFreshEpoch(routerId) : 0;
  const [awaitingFresh, setAwaitingFresh] = useState(() => connectEpoch > 0);
  const [awaitingRouterSwitch, setAwaitingRouterSwitch] = useState(false);

  const prevRouterIdRef = useRef<number | null>(routerId);
  const connectEpochRef = useRef(connectEpoch);
  connectEpochRef.current = connectEpoch;

  const openStrictFreshGate = useCallback((epochMs: number) => {
    if (epochMs <= 0) return;
    setAwaitingFresh(true);
    setSsePriority(null);
    setSseConnected(false);
  }, []);

  if (routerId !== prevRouterIdRef.current) {
    prevRouterIdRef.current = routerId;
    const epoch = getRouterConnectFreshEpoch(routerId);
    setAwaitingFresh(epoch > 0);
    setSsePriority(null);
    setSseConnected(false);
    const cached = routerId != null ? readPriorityCacheForDisplay(routerId) : null;
    setAwaitingRouterSwitch(!!routerId && !isPrioritySnapshotFreshForSwitch(cached));
  }

  useLayoutEffect(() => {
    if (!routerId) {
      setAwaitingFresh(false);
      setAwaitingRouterSwitch(false);
    }
  }, [routerId]);

  useLayoutEffect(() => {
    const onFreshGate = (ev: Event) => {
      const detail = (ev as CustomEvent<{ routerId?: number | null; epochMs?: number }>).detail;
      if (detail?.routerId != null && detail.routerId !== routerId) return;
      const epoch = detail?.epochMs ?? getRouterConnectFreshEpoch(routerId);
      if (epoch > 0) openStrictFreshGate(epoch);
    };
    const onReleaseGate = (ev: Event) => {
      const detail = (ev as CustomEvent<{ routerId?: number | null }>).detail;
      if (detail?.routerId != null && detail.routerId !== routerId) return;
      setAwaitingFresh(false);
    };
    window.addEventListener(VOUCHERNET_DASHBOARD_FRESH_GATE_EVENT, onFreshGate);
    window.addEventListener(VOUCHERNET_DASHBOARD_RELEASE_GATE_EVENT, onReleaseGate);
    return () => {
      window.removeEventListener(VOUCHERNET_DASHBOARD_FRESH_GATE_EVENT, onFreshGate);
      window.removeEventListener(VOUCHERNET_DASHBOARD_RELEASE_GATE_EVENT, onReleaseGate);
    };
  }, [routerId, openStrictFreshGate]);

  const tryReleaseFreshGate = useCallback((snapshot: PrioritySnapshot | null | undefined) => {
    if (!routerId || !snapshot) return;
    const epoch = connectEpochRef.current;
    if (epoch > 0 && !isSnapshotMikrotikFreshAfterEpoch(snapshot, epoch)) return;
    setAwaitingFresh(false);
    if (epoch > 0) finishRouterConnectFreshEpoch(routerId);
  }, [routerId]);

  const tryReleaseRouterSwitchGate = useCallback((snapshot: PrioritySnapshot | null | undefined) => {
    if (!snapshot) return;
    if (isPrioritySnapshotFreshForSwitch(snapshot)) {
      setAwaitingRouterSwitch(false);
      return;
    }
    // Infos routeur fraîches seules : afficher la barre sans attendre toutes les cartes KPI.
    if (isPriorityInfoDisplayable(snapshot)) {
      const ageMs = snapshot.serverTs ? Date.now() - snapshot.serverTs : null;
      if (ageMs != null && ageMs <= ROUTER_SWITCH_FRESH_MAX_AGE_MS) {
        setAwaitingRouterSwitch(false);
      }
    }
  }, []);

  const priorityQueryKey = useMemo(
    () => (connectEpoch > 0
      ? (["router-dashboard-priority", routerId, connectEpoch] as const)
      : (["router-dashboard-priority", routerId] as const)),
    [routerId, connectEpoch],
  );

  const {
    data: httpPriority,
    isFetching: priorityQueryFetching,
    isLoading: priorityLoading,
    dataUpdatedAt: priorityUpdatedAt,
    refetch: refetchPriority,
    isError: priorityIsError,
    errorUpdatedAt: priorityErrorUpdatedAt,
  } = useQuery<PrioritySnapshot>({
    queryKey: priorityQueryKey,
    queryFn: async ({ signal }) => {
      const needsWait = connectEpochRef.current > 0;
      const q = needsWait ? "?fast=1&fresh=1&wait=1" : "?fast=1";
      try {
        const res = await fetch(`${BASE}/api/routers/${routerId}/dashboard-priority${q}`, { signal });
        if (!res.ok) throw new Error("dashboard priority unavailable");
        return res.json() as Promise<PrioritySnapshot>;
      } catch (err) {
        if (signal.aborted) {
          const cached = routerId != null ? readPriorityCacheForDisplay(routerId) : null;
          if (cached) return cached;
        }
        throw err;
      }
    },
    placeholderData: () => (
      routerId != null ? readPriorityCacheForDisplay(routerId) ?? undefined : undefined
    ),
    enabled: isVisible && !!routerId,
    refetchInterval: (sseConnected || !isVisible || (connectEpoch > 0 && awaitingFresh)) ? false : KPI_POLL_MS,
    refetchIntervalInBackground: false,
    staleTime: KPI_POLL_MS - 1_000,
    gcTime: 5 * 60_000,
    retry: 1,
    throwOnError: false,
    structuralSharing: false,
  });

  useEffect(() => {
    const onResume = () => {
      if (routerId && isVisible) void refetchPriority();
    };
    window.addEventListener(VOUCHERNET_APP_RESUME_EVENT, onResume);
    return () => window.removeEventListener(VOUCHERNET_APP_RESUME_EVENT, onResume);
  }, [routerId, isVisible, refetchPriority]);

  useEffect(() => {
    if (!awaitingFresh || !routerId || !httpPriority) return;
    tryReleaseFreshGate(httpPriority);
  }, [awaitingFresh, routerId, httpPriority, tryReleaseFreshGate]);

  useEffect(() => {
    if (!awaitingRouterSwitch) return;
    tryReleaseRouterSwitchGate(httpPriority ?? ssePriority);
  }, [awaitingRouterSwitch, httpPriority, ssePriority, tryReleaseRouterSwitchGate]);

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
        const epoch = connectEpochRef.current;
        if (epoch > 0 && !isSnapshotMikrotikFreshAfterEpoch(payload, epoch)) return;
        setSsePriority(payload);
        writePriorityCache(routerId, payload);
        tryReleaseFreshGate(payload);
        tryReleaseRouterSwitchGate(payload);
      } catch {
        /* polling fallback */
      }
    };
    es.addEventListener("priority", onPriority as EventListener);
    es.onerror = () => setSseConnected(false);
    const onClientDisconnect = () => {
      es.close();
      setSseConnected(false);
    };
    window.addEventListener(VOUCHERNET_CLIENT_DISCONNECT_EVENT, onClientDisconnect);
    return () => {
      window.removeEventListener(VOUCHERNET_CLIENT_DISCONNECT_EVENT, onClientDisconnect);
      es.removeEventListener("priority", onPriority as EventListener);
      es.close();
      setSseConnected(false);
    };
  }, [routerId, authToken, isVisible, tryReleaseFreshGate, tryReleaseRouterSwitchGate]);

  const strictConnectGate = connectEpoch > 0 && awaitingFresh;

  const livePriority = useMemo(
    () => mergePrioritySnapshots(
      httpPriority,
      ssePriority,
      sseConnected,
      routerId,
      { skipCacheMerge: strictConnectGate || awaitingRouterSwitch },
    ),
    [httpPriority, ssePriority, sseConnected, routerId, strictConnectGate, awaitingRouterSwitch],
  );

  useEffect(() => {
    if (!routerId || !livePriority || strictConnectGate) return;
    writePriorityCache(routerId, livePriority);
  }, [routerId, livePriority, strictConnectGate]);

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
  const salesFetching = (strictConnectGate || awaitingRouterSwitch) && priorityQueryFetching;

  const displayableLive = livePriority && isPriorityCacheDisplayable(livePriority);
  const infoDisplayable = isPriorityInfoDisplayable(livePriority);
  const hideLivePriority =
    !livePriority
    || (
      (strictConnectGate || awaitingRouterSwitch)
      && !displayableLive
      && !infoDisplayable
    );

  return {
    livePriority: hideLivePriority ? null : livePriority,
    sales: hideLivePriority ? undefined : sales,
    salesKpiReady: hideLivePriority ? false : salesKpiReady,
    rankingReady: hideLivePriority ? false : rankingReady,
    salesFetching,
    sseConnected,
    priorityLoading: (priorityLoading || strictConnectGate || awaitingRouterSwitch) && !displayableLive,
    priorityUpdatedAt,
    priorityQueryFetching,
    liveSnapshotAgeMs,
    refetchPriority,
    priorityIsError,
    priorityErrorUpdatedAt,
    awaitingRouterSwitch: strictConnectGate || awaitingRouterSwitch,
    awaitingFreshData: strictConnectGate || awaitingRouterSwitch,
  };
}
