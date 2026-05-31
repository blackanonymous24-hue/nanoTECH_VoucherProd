import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouterContext } from "@/contexts/RouterContext";
import { pingRouterMikhmonSequence } from "@/lib/mikhmon-ping-sequence";
import { pingRouterTcpApi } from "@/lib/router-connection-test";
import { usePageVisibility } from "@/hooks/use-page-visibility";
import { VOUCHERNET_APP_RESUME_EVENT } from "@/lib/dashboard-resume";

/** Cadence re-ping style MikHmon pendant qu'un routeur est sélectionné. */
export const MIKHMON_PING_POLL_MS = 10_000;

/**
 * Statut en ligne/hors ligne = ping TCP MikHmon (badge sidebar uniquement).
 * N'appelle jamais confirmRouterOffline : multi-appareils — un échec ping local
 * ne bloque pas les données (cache serveur partagé) ni les actions API.
 */
export function useRouterTcpPing(routerId: number | null, enabled = true) {
  const { token } = useAuth();
  const isVisible = usePageVisibility();
  const {
    setRouterOnline,
    setIsPingChecking,
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

    const applyOnline = (id: number) => {
      setRouterOnline(true);
      setIsPingFailed(false);
      clearRouterOfflineMark();
    };

    /** Badge hors ligne seulement — pas de purge cache ni overlay (multi-appareils). */
    const applyOfflineSoft = (id: number) => {
      if (cancelled || routerIdRef.current !== id) return;
      setRouterOnline(false);
    };

    const runInitial = async () => {
      if (skipNextTcpPingInitialRef.current) {
        skipNextTcpPingInitialRef.current = false;
        return;
      }
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      const id = routerId;
      try {
        const cached = await pingRouterTcpApi(id, token, { force: false });
        if (cancelled || routerIdRef.current !== id) return;
        if (cached.success) {
          applyOnline(id);
          return;
        }
        const ok = await runTriplet(id);
        if (cancelled || routerIdRef.current !== id) return;
        if (ok) applyOnline(id);
        else applyOfflineSoft(id);
      } finally {
        inFlightRef.current = false;
      }
    };

    const runPoll = async () => {
      if (inFlightRef.current || isPingFailed) return;
      inFlightRef.current = true;
      const id = routerId;
      try {
        const quick = await pingRouterTcpApi(id, token, { force: false });
        if (cancelled || routerIdRef.current !== id) return;
        if (quick.success) {
          applyOnline(id);
          return;
        }
        const ok = await runTriplet(id);
        if (cancelled || routerIdRef.current !== id) return;
        if (ok) applyOnline(id);
        else applyOfflineSoft(id);
      } finally {
        inFlightRef.current = false;
      }
    };

    void runInitial();
    const timer = window.setInterval(() => { void runPoll(); }, MIKHMON_PING_POLL_MS);

    const onAppResume = () => {
      if (cancelled || routerIdRef.current == null || isPingFailed) return;
      void pingRouterTcpApi(routerIdRef.current, token, { force: false }).then((r) => {
        if (cancelled || !routerIdRef.current) return;
        if (r.success) applyOnline(routerIdRef.current);
      });
    };
    window.addEventListener(VOUCHERNET_APP_RESUME_EVENT, onAppResume);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener(VOUCHERNET_APP_RESUME_EVENT, onAppResume);
    };
  }, [
    routerId,
    enabled,
    isVisible,
    token,
    setRouterOnline,
    setIsPingChecking,
    clearRouterOfflineMark,
    isPingFailed,
    skipNextTcpPingInitialRef,
  ]);
}
