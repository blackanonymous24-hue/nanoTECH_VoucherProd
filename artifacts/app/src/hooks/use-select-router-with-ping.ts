import { useState, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useRouterContext, type BorrowedRouter } from "@/contexts/RouterContext";
import {
  beginRouterConnectFreshEpoch,
  releaseDashboardFreshGate,
} from "@/lib/dashboard-resume";
import {
  fetchRouterForConnectWithRetries,
} from "@/lib/router-connect-fetch";

export type SelectRouterSource = "selector" | "routers-page" | "quick-connect";

const CONNECT_RETRY_TOAST =
  "Impossible de contacter le Routeur, nouvelle tentative en cours";

/**
 * Connexion routeur style MikHmon.
 * - **Page Routeurs** : 2 tentatives fetch (3 s max), toast au 1er échec, badge au 2e.
 * - **Sélecteur** : 2 tentatives (3 s max chacune), toast après 1er échec, puis overlay 10 s → /routers.
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
  const [, navigate] = useLocation();
  const [connectingId, setConnectingId] = useState<number | null>(null);
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

  const showConnectRetryToast = useCallback(() => {
    toast.error(CONNECT_RETRY_TOAST, {
      id: "router-connect-retry",
      duration: 4000,
    });
  }, []);

  const connectFromSelectorWithRetries = useCallback(async (id: number): Promise<boolean> => {
    toast.dismiss("router-ping-fail");
    toast.dismiss("router-connect-fail");
    toast.dismiss("router-connect-retry");
    return fetchRouterForConnectWithRetries(id, showConnectRetryToast);
  }, [showConnectRetryToast]);

  /** Page Routeurs : 2 tentatives fetch, toast au 1er échec, badge au 2e — pas d'overlay. */
  const connectFromRoutersPage = useCallback(
    async (id: number): Promise<"online" | "offline"> => {
      if (activeRef.current) return "offline";
      activeRef.current = true;
      setConnectingId(id);
      beginConnect(id);

      try {
        toast.dismiss("router-ping-fail");
        toast.dismiss("router-connect-fail");
        toast.dismiss("router-connect-retry");
        const online = await fetchRouterForConnectWithRetries(id, showConnectRetryToast);
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
    [beginConnect, setRouterOnline, markRouterOffline, setIsPingChecking, showConnectRetryToast],
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
      beginConnect(id, opts);

      const dest = opts?.navigateTo;

      try {
        const online = await connectFromSelectorWithRetries(id);
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
    [beginConnect, setRouterOnline, confirmRouterOffline, setIsPingChecking, navigate, connectFromSelectorWithRetries],
  );

  return { selectWithPing, connectFromRoutersPage, pingingId: connectingId, connectingId };
}
