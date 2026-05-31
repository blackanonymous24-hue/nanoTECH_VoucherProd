import { useState, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useRouterContext, type BorrowedRouter } from "@/contexts/RouterContext";
import { releaseDashboardFreshGate } from "@/lib/dashboard-resume";
import { fetchRouterForConnectFromPageWithRetries } from "@/lib/router-connect-fetch";

export type SelectRouterSource = "selector" | "routers-page" | "quick-connect";

const CONNECT_RETRY_TOAST =
  "Impossible de contacter le Routeur, nouvelle tentative en cours";

/**
 * Connexion routeur style MikHmon.
 * - **Page Routeurs & sélecteur** : ping TCP + cache serveur (instantané), KPI fresh en arrière-plan.
 * - Toast au 1er échec ; badge (page Routeurs) ou overlay 10 s → /routers (sélecteur).
 */
export function useSelectRouterWithPing() {
  const { token } = useAuth();
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
  const [, navigate] = useLocation();
  const [connectingId, setConnectingId] = useState<number | null>(null);
  const activeRef = useRef(false);

  const beginConnectFast = useCallback(
    (id: number, opts?: { routerData?: BorrowedRouter | null }) => {
      if (opts?.routerData !== undefined) {
        setBorrowedRouter(opts.routerData);
      }
      clearRouterOfflineMark();
      setIsPingFailed(false);
      setIsPingChecking(true);
      setRouterOnline(null);
      skipNextTcpPingInitialRef.current = true;
      setSelectedRouterId(id);
    },
    [setBorrowedRouter, clearRouterOfflineMark, setIsPingFailed, setIsPingChecking, setRouterOnline, setSelectedRouterId, skipNextTcpPingInitialRef],
  );

  const showConnectRetryToast = useCallback(() => {
    toast.error(CONNECT_RETRY_TOAST, {
      id: "router-connect-retry",
      duration: 4000,
    });
  }, []);

  const connectFastWithRetries = useCallback(
    async (id: number): Promise<boolean> => {
      toast.dismiss("router-ping-fail");
      toast.dismiss("router-connect-fail");
      toast.dismiss("router-connect-retry");
      return fetchRouterForConnectFromPageWithRetries(id, token, showConnectRetryToast);
    },
    [token, showConnectRetryToast],
  );

  /** Page Routeurs : ping TCP + cache serveur, KPI fresh en arrière-plan. */
  const connectFromRoutersPage = useCallback(
    async (id: number): Promise<"online" | "offline"> => {
      if (activeRef.current) return "offline";
      activeRef.current = true;
      setConnectingId(id);
      beginConnectFast(id);

      try {
        const online = await connectFastWithRetries(id);
        setIsPingChecking(false);
        if (online) {
          toast.dismiss("router-connect-retry");
          setRouterOnline(true);
          return "online";
        }
        toast.dismiss("router-connect-retry");
        releaseDashboardFreshGate(id);
        markRouterOffline(id);
        setRouterOnline(false);
        return "offline";
      } finally {
        activeRef.current = false;
        setConnectingId(null);
      }
    },
    [beginConnectFast, setRouterOnline, markRouterOffline, setIsPingChecking, connectFastWithRetries],
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
      setConnectingId(id);
      beginConnectFast(id, opts);

      const dest = opts?.navigateTo;

      try {
        const online = await connectFastWithRetries(id);
        setIsPingChecking(false);

        if (online) {
          toast.dismiss("router-connect-retry");
          setRouterOnline(true);
          if (dest !== false) navigate(dest ?? "/");
          return;
        }

        toast.dismiss("router-connect-retry");
        releaseDashboardFreshGate(id);
        confirmRouterOffline(id);
      } finally {
        activeRef.current = false;
        setConnectingId(null);
      }
    },
    [beginConnectFast, setRouterOnline, confirmRouterOffline, setIsPingChecking, navigate, connectFastWithRetries],
  );

  return { selectWithPing, connectFromRoutersPage, pingingId: connectingId, connectingId };
}
