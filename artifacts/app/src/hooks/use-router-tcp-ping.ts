import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouterContext } from "@/contexts/RouterContext";
import { pingRouterMikhmonOnce } from "@/lib/mikhmon-ping-sequence";
import { usePageVisibility } from "@/hooks/use-page-visibility";

/** Cadence re-ping style MikHmon pendant qu'un routeur est sélectionné. */
export const MIKHMON_PING_POLL_MS = 10_000;

/**
 * Badge en ligne/hors ligne = 1 ping TCP (`force=1`) toutes les 10 s.
 * Pas de triplet ×3 ici — réservé au sélecteur sidebar.
 */
export function useRouterTcpPing(routerId: number | null, enabled = true) {
  const { token } = useAuth();
  const isVisible = usePageVisibility();
  const {
    setRouterOnline,
    markRouterOffline,
    clearRouterOfflineMark,
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

    const runPing = async (id: number): Promise<boolean> => {
      return pingRouterMikhmonOnce(id, token);
    };

    const applyOnline = (id: number) => {
      setRouterOnline(true);
      clearRouterOfflineMark();
    };

    const applyOffline = (id: number) => {
      if (cancelled || routerIdRef.current !== id) return;
      markRouterOffline(id);
      setRouterOnline(false);
    };

    const runCheck = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      const id = routerId;
      try {
        const ok = await runPing(id);
        if (cancelled || routerIdRef.current !== id) return;
        if (ok) applyOnline(id);
        else applyOffline(id);
      } finally {
        inFlightRef.current = false;
      }
    };

    void runCheck();
    const timer = window.setInterval(() => { void runCheck(); }, MIKHMON_PING_POLL_MS);
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
    markRouterOffline,
    clearRouterOfflineMark,
    isPingFailed,
    skipNextTcpPingInitialRef,
  ]);
}
