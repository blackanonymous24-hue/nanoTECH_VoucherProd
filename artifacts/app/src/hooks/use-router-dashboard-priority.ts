import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { usePageVisibility } from "@/hooks/use-page-visibility";
import {
  mergePrioritySnapshots,
  writePriorityCache,
  type PrioritySnapshot,
} from "@/lib/dashboard-priority";
import {
  VOUCHERNET_APP_RESUME_EVENT,
  VOUCHERNET_DASHBOARD_FRESH_GATE_EVENT,
  VOUCHERNET_DASHBOARD_RELEASE_GATE_EVENT,
} from "@/lib/dashboard-resume";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * KPI dashboard : pas d’affichage de cache tant qu’un fetch HTTP n’a pas abouti
 * après changement de routeur ou reprise onglet/APK (évite le flash de données vieilles).
 */
export function useRouterDashboardPriority(routerId: number | null) {
  const { token: authToken } = useAuth();
  const isVisible = usePageVisibility();
  const [ssePriority, setSsePriority] = useState<PrioritySnapshot | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const [awaitingFresh, setAwaitingFresh] = useState(() => routerId != null);

  const freshGateOpenedAtRef = useRef(routerId != null ? Date.now() : 0);
  const prevRouterIdRef = useRef<number | null>(routerId);

  const openFreshGate = useCallback(() => {
    freshGateOpenedAtRef.current = Date.now();
    setAwaitingFresh(true);
    setSsePriority(null);
    setSseConnected(false);
  }, []);

  // Réinitialisation synchrone au changement de routeur — évite 1 frame avec le cache préchargé.
  if (routerId !== prevRouterIdRef.current) {
    prevRouterIdRef.current = routerId;
    freshGateOpenedAtRef.current = Date.now();
    setAwaitingFresh(routerId != null);
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
        `${BASE}/api/routers/${routerId}/dashboard-priority?fresh=1`,
        { signal },
      );
      if (!res.ok) throw new Error("dashboard priority unavailable");
      return res.json() as Promise<PrioritySnapshot>;
    },
    enabled: isVisible && !!routerId,
    refetchInterval: (sseConnected || !isVisible || awaitingFresh) ? false : 20_000,
    refetchIntervalInBackground: false,
    staleTime: 0,
    gcTime: 5 * 60_000,
    retry: false,
    throwOnError: false,
    structuralSharing: false,
    refetchOnMount: "always",
  });

  useEffect(() => {
    if (!awaitingFresh || !routerId) return;
    if (priorityQueryFetching || priorityLoading) return;
    if (!httpPriority) return;
    if (priorityUpdatedAt < freshGateOpenedAtRef.current - 50) return;
    setAwaitingFresh(false);
  }, [
    awaitingFresh,
    routerId,
    priorityQueryFetching,
    priorityLoading,
    httpPriority,
    priorityUpdatedAt,
  ]);

  useEffect(() => {
    if (!routerId || !authToken || !isVisible || awaitingFresh) {
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
  }, [routerId, authToken, isVisible, awaitingFresh]);

  const livePriority = useMemo(
    () => (awaitingFresh ? null : mergePrioritySnapshots(httpPriority, ssePriority, sseConnected, routerId, {
      skipCacheMerge: true,
    })),
    [awaitingFresh, httpPriority, ssePriority, sseConnected, routerId],
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
  const salesFetching = awaitingFresh || priorityQueryFetching;

  return {
    livePriority,
    sales,
    salesKpiReady,
    rankingReady,
    salesFetching,
    sseConnected,
    priorityLoading: priorityLoading || awaitingFresh,
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
