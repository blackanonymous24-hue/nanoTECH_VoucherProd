import { useState, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useRouterContext, type BorrowedRouter } from "@/contexts/RouterContext";
import {
  beginRouterConnectFreshEpoch,
  releaseDashboardFreshGate,
} from "@/lib/dashboard-resume";
import { fetchRouterForConnect } from "@/lib/router-connect-fetch";

export type SelectRouterSource = "selector" | "routers-page" | "quick-connect";

const CONNECT_FAIL_TOAST = "Impossible de récupérer les données du routeur";

/**
 * Connexion routeur style MikHmon : fetch API MikroTik (fresh+wait).
 * Données OK → en ligne + affichage. Échec → hors ligne (sans ping TCP ×3).
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

  const connectViaMikhmonFetch = useCallback(async (id: number): Promise<boolean> => {
    toast.dismiss("router-ping-fail");
    toast.dismiss("router-connect-fail");
    const online = await fetchRouterForConnect(id);
    if (!online) {
      toast.error(CONNECT_FAIL_TOAST, {
        id: "router-connect-fail",
        description: "MikroTik éteint ou hors ligne.",
        duration: 5000,
      });
    }
    return online;
  }, []);

  const connectFromRoutersPage = useCallback(
    async (id: number): Promise<"online" | "offline"> => {
      if (activeRef.current) return "offline";
      activeRef.current = true;
      setPingingId(id);
      beginConnect(id);

      try {
        const online = await connectViaMikhmonFetch(id);
        setIsPingChecking(false);
        if (online) {
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
    [beginConnect, setRouterOnline, markRouterOffline, setIsPingChecking, connectViaMikhmonFetch],
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
        const online = await connectViaMikhmonFetch(id);
        setIsPingChecking(false);

        if (online) {
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
    [beginConnect, setRouterOnline, confirmRouterOffline, setIsPingChecking, navigate, connectViaMikhmonFetch],
  );

  return { selectWithPing, connectFromRoutersPage, pingingId };
}
