import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouterContext } from "@/contexts/RouterContext";
import { pingRouterMikhmonSequence } from "@/lib/mikhmon-ping-sequence";
import { pingRouterTcpApi } from "@/lib/router-connection-test";
import { usePageVisibility } from "@/hooks/use-page-visibility";
import { prefetchRouterDashboardPriority } from "@/lib/prefetch-router-dashboard-priority";
import {
  finishRouterConnectFreshEpoch,
  getRouterConnectFreshEpoch,
} from "@/lib/dashboard-resume";

/** Cadence re-ping style MikHmon pendant qu'un routeur est sélectionné. */
export const MIKHMON_PING_POLL_MS = 10_000;

/**
 * Statut en ligne/hors ligne = ping TCP MikHmon uniquement.
 * 3 échecs consécutifs → confirmRouterOffline (page erreur + redirection /routers).
 */
export function useRouterTcpPing(routerId: number | null, enabled = true) {
  const { token } = useAuth();
  const isVisible = usePageVisibility();
  const {
    setRouterOnline,
    setIsPingChecking,
    confirmRouterOffline,
    clearRouterOfflineMark,
    setIsPingFailed,
    isPingFailed,
    skipNextTcpPingInitialRef,
  } = useRouterContext();
  const inFlightRef = useRef(false);
  const routerIdRef = useRef(routerId);

  useEffect(() => {
    routerIdRef.current = routerId;
  }, [routerId]);

  useEffect(() => {
    if (!enabled || !isVisible || routerId == null || isPingFailed) return;

    let cancelled = false;

    const runTriplet = async (id: number): Promise<boolean> => {
      setIsPingChecking(true);
      try {
        return await pingRouterMikhmonSequence(id, token);
      } finally {
        if (!cancelled && routerIdRef.current === id) {
          setIsPingChecking(false);
        }
      }
    };

    const applyOnline = async (id: number) => {
      const epoch = getRouterConnectFreshEpoch(id);
      if (epoch > 0) {
        try {
          await prefetchRouterDashboardPriority(id, { fresh: true, wait: true });
        } catch { /* polling reprendra */ }
        finishRouterConnectFreshEpoch(id);
      }
      setRouterOnline(true);
      setIsPingFailed(false);
      clearRouterOfflineMark();
    };

    const applyOffline = (id: number) => {
      if (cancelled || routerIdRef.current !== id) return;
      confirmRouterOffline(id);
    };

    const runInitial = async () => {
      if (skipNextTcpPingInitialRef.current) {
        skipNextTcpPingInitialRef.current = false;
        return;
      }
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      const id = routerId;
      setRouterOnline(null);
      try {
        const ok = await runTriplet(id);
        if (cancelled || routerIdRef.current !== id) return;
        if (ok) await applyOnline(id);
        else applyOffline(id);
      } finally {
        inFlightRef.current = false;
      }
    };

    const runPoll = async () => {
      if (inFlightRef.current || isPingFailed) return;
      inFlightRef.current = true;
      const id = routerId;
      try {
        const quick = await pingRouterTcpApi(id, token, { force: true });
        if (cancelled || routerIdRef.current !== id) return;
        if (quick.success) {
          await applyOnline(id);
          return;
        }
        const ok = await runTriplet(id);
        if (cancelled || routerIdRef.current !== id) return;
        if (ok) await applyOnline(id);
        else applyOffline(id);
      } finally {
        inFlightRef.current = false;
      }
    };

    void runInitial();
    const timer = window.setInterval(() => { void runPoll(); }, MIKHMON_PING_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    routerId,
    enabled,
    isVisible,
    token,
    setRouterOnline,
    setIsPingChecking,
    confirmRouterOffline,
    clearRouterOfflineMark,
    isPingFailed,
    skipNextTcpPingInitialRef,
  ]);
}
