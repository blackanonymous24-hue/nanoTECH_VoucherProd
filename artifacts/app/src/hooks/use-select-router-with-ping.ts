import { useState, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useRouterContext, type BorrowedRouter } from "@/contexts/RouterContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  beginRouterConnectFreshEpoch,
  releaseDashboardFreshGate,
} from "@/lib/dashboard-resume";
import { prefetchRouterDashboardPriority } from "@/lib/prefetch-router-dashboard-priority";
import {
  MIKHMON_PING_MAX_ATTEMPTS,
  pingRouterMikhmonOnce,
  pingRouterMikhmonSelectorVerify,
} from "@/lib/mikhmon-ping-sequence";

const SELECTOR_RETRY_TOAST =
  "Impossible de contacter le Mikrotik, nouvelle tentative en cours...";

export type SelectRouterSource = "selector" | "routers-page" | "quick-connect";

/**
 * Connexion routeur : 1 ping TCP rapide puis navigation immédiate.
 *
 * - **Sélecteur** : ping ×1, si échec ×2 vérifications → page erreur.
 * - **Page Routeurs / autre** : ping ×1 seulement, badge hors ligne.
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
      void prefetchRouterDashboardPriority(id, { fresh: true, wait: true });
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
        const ok = await pingRouterMikhmonOnce(id, token);
        setIsPingChecking(false);
        if (ok) {
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
    [token, beginConnect, setRouterOnline, markRouterOffline, setIsPingChecking],
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
      const fromSelector = opts?.source === "selector";

      try {
        const ok = fromSelector
          ? await pingRouterMikhmonSelectorVerify(id, token, onRetryToast)
          : await pingRouterMikhmonOnce(id, token);
        setIsPingChecking(false);

        if (ok) {
          setRouterOnline(true);
          if (dest !== false) navigate(dest ?? "/");
          return;
        }

        releaseDashboardFreshGate(id);
        if (fromSelector) {
          confirmRouterOffline(id);
          navigate("/");
        } else {
          markRouterOffline(id);
          setRouterOnline(false);
        }
      } finally {
        activeRef.current = false;
        setPingingId(null);
      }
    },
    [token, beginConnect, setRouterOnline, confirmRouterOffline, markRouterOffline, setIsPingChecking, navigate, onRetryToast],
  );

  return { selectWithPing, connectFromRoutersPage, pingingId };
}
