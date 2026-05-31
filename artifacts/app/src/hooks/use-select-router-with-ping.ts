import { useState, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useRouterContext, type BorrowedRouter } from "@/contexts/RouterContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  beginRouterConnectFreshEpoch,
  finishRouterConnectFreshEpoch,
  releaseDashboardFreshGate,
} from "@/lib/dashboard-resume";
import { prefetchRouterDashboardPriority } from "@/lib/prefetch-router-dashboard-priority";
import {
  MIKHMON_PING_MAX_ATTEMPTS,
  pingRouterMikhmonSequence,
} from "@/lib/mikhmon-ping-sequence";

const SELECTOR_RETRY_TOAST =
  "Impossible de contacter le Mikrotik, nouvelle tentative en cours...";

export type SelectRouterSource = "selector" | "routers-page" | "quick-connect";

/** Ping TCP MikHmon ×3 — seul critère En ligne / Hors ligne. */
async function mikhmonPingOnly(
  id: number,
  token: string | null | undefined,
  onRetry?: (attempt: number) => void,
): Promise<"online" | "offline"> {
  const ok = await pingRouterMikhmonSequence(id, token, (attempt) => {
    if (attempt > 1) onRetry?.(attempt);
  });
  return ok ? "online" : "offline";
}

/** Fetch KPI MikroTik bloquant (fresh+wait) avant d'afficher le dashboard. */
async function loadFreshDashboardAfterPing(routerId: number): Promise<void> {
  await prefetchRouterDashboardPriority(routerId, { fresh: true, wait: true });
  finishRouterConnectFreshEpoch(routerId);
}

/**
 * Connexion routeur : ping TCP MikHmon ×3 puis fetch KPI frais (wait MikroTik).
 *
 * - **Page Routeurs** : ping ×3, badge hors ligne, pas de navigation.
 * - **Sélecteur** : ping ×3 + toasts, page d'erreur 10 s → /routers.
 */
export function useSelectRouterWithPing() {
  const {
    setSelectedRouterId,
    setIsPingFailed,
    setIsPingChecking,
    skipNextTcpPingInitialRef,
    setBorrowedRouter,
    setRouterOnline,
    markRouterOffline,
    clearRouterOfflineMark,
    confirmRouterOffline,
  } = useRouterContext();
  const { token } = useAuth();
  const [, navigate] = useLocation();
  const [pingingId, setPingingId] = useState<number | null>(null);
  const activeRef = useRef(false);

  const beginConnect = useCallback(
    (id: number, opts?: { routerData?: BorrowedRouter | null }) => {
      if (opts?.routerData !== undefined) {
        setBorrowedRouter(opts.routerData);
      }
      clearRouterOfflineMark();
      setIsPingFailed(false);
      setIsPingChecking(true);
      setRouterOnline(null);
      skipNextTcpPingInitialRef.current = true;
      beginRouterConnectFreshEpoch(id);
      setSelectedRouterId(id);
    },
    [setBorrowedRouter, clearRouterOfflineMark, setIsPingFailed, setIsPingChecking, setRouterOnline, setSelectedRouterId, skipNextTcpPingInitialRef],
  );

  const onRetryToast = useCallback((attempt: number) => {
    toast.error(SELECTOR_RETRY_TOAST, {
      duration: 4000,
      id: "router-ping-fail",
      description: `Tentative ${attempt}/${MIKHMON_PING_MAX_ATTEMPTS}…`,
    });
  }, []);

  const connectFromRoutersPage = useCallback(
    async (id: number): Promise<"online" | "offline"> => {
      if (activeRef.current) return "offline";
      activeRef.current = true;
      setPingingId(id);
      beginConnect(id);

      try {
        const status = await mikhmonPingOnly(id, token, onRetryToast);
        setIsPingChecking(false);
        if (status === "online") {
          await loadFreshDashboardAfterPing(id);
          setRouterOnline(true);
          return "online";
        }
        releaseDashboardFreshGate(id);
        markRouterOffline(id);
        setRouterOnline(false);
        return "offline";
      } finally {
        activeRef.current = false;
        setPingingId(null);
      }
    },
    [token, beginConnect, setRouterOnline, markRouterOffline, setIsPingChecking, onRetryToast],
  );

  const selectWithPing = useCallback(
    async (
      id: number,
      opts?: {
        navigateTo?: string | false;
        routerData?: BorrowedRouter | null;
        source?: SelectRouterSource;
      },
    ) => {
      if (activeRef.current) return;
      activeRef.current = true;
      setPingingId(id);
      beginConnect(id, opts);

      const dest = opts?.navigateTo;

      try {
        const status = await mikhmonPingOnly(id, token, onRetryToast);
        setIsPingChecking(false);

        if (status === "online") {
          await loadFreshDashboardAfterPing(id);
          setRouterOnline(true);
          if (dest !== false) navigate(dest ?? "/");
          return;
        }

        releaseDashboardFreshGate(id);
        confirmRouterOffline(id);
        navigate("/");
      } finally {
        activeRef.current = false;
        setPingingId(null);
      }
    },
    [token, beginConnect, setRouterOnline, confirmRouterOffline, setIsPingChecking, navigate, onRetryToast],
  );

  return { selectWithPing, connectFromRoutersPage, pingingId };
}
