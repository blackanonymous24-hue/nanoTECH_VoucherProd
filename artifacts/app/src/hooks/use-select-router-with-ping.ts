import { useState, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useRouterContext, type BorrowedRouter } from "@/contexts/RouterContext";
import { useAuth } from "@/contexts/AuthContext";
import { pingRouterTcpApi } from "@/lib/router-connection-test";
import { openDashboardFreshGate, releaseDashboardFreshGate } from "@/lib/dashboard-resume";
import { writePriorityCache, type PrioritySnapshot } from "@/lib/dashboard-priority";
import { queryClient } from "@/lib/queryClient";
import { waitForRouterSnapshot } from "@/lib/wait-router-snapshot";

const SELECTOR_RETRY_TOAST =
  "Impossible de contacter le Mikrotik, nouvelle tentative en cours...";

export type SelectRouterSource = "selector" | "routers-page" | "quick-connect";

function seedSnapshotCache(id: number, snapshot: PrioritySnapshot) {
  queryClient.setQueryData(["router-dashboard-priority", id], snapshot);
  writePriorityCache(id, snapshot);
}

/** Snapshot 3 s puis ping TCP unique. */
async function snapshotThenPing(
  id: number,
  token: string | null | undefined,
): Promise<"online" | "offline"> {
  const { responded, snapshot } = await waitForRouterSnapshot(id);
  if (responded && snapshot) {
    seedSnapshotCache(id, snapshot);
    return "online";
  }
  const ping = await pingRouterTcpApi(id, token, { force: true });
  return ping.success ? "online" : "offline";
}

/**
 * Connexion routeur : attendre le snapshot MikroTik (3 s), puis ping TCP si besoin.
 *
 * - **Page Routeurs** : `connectFromRoutersPage` — ping unique, badge hors ligne, pas de navigation.
 * - **Sélecteur** : 3 pings + toasts, page d’erreur 10 s → /routers.
 */
export function useSelectRouterWithPing() {
  const {
    setSelectedRouterId,
    setIsPingFailed,
    setBorrowedRouter,
    setRouterOnline,
    markRouterOffline,
    clearRouterOfflineMark,
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
      openDashboardFreshGate(id);
      setSelectedRouterId(id);
    },
    [setBorrowedRouter, clearRouterOfflineMark, setIsPingFailed, setSelectedRouterId],
  );

  const connectFromRoutersPage = useCallback(
    async (id: number): Promise<"online" | "offline"> => {
      if (activeRef.current) return "offline";
      activeRef.current = true;
      setPingingId(id);
      beginConnect(id);

      try {
        const status = await snapshotThenPing(id, token);
        if (status === "online") {
          releaseDashboardFreshGate(id);
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
    [token, beginConnect, setRouterOnline, markRouterOffline],
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
        const { responded, snapshot } = await waitForRouterSnapshot(id);
        if (responded && snapshot) {
          seedSnapshotCache(id, snapshot);
          releaseDashboardFreshGate(id);
          setRouterOnline(true);
          if (dest !== false) navigate(dest ?? "/");
          return;
        }

        let success = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          const data = await pingRouterTcpApi(id, token, { force: true });
          if (data.success) {
            success = true;
            break;
          }
          toast.error(SELECTOR_RETRY_TOAST, {
            duration: 4000,
            id: "router-ping-fail",
          });
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 500));
          }
        }

        if (success) {
          releaseDashboardFreshGate(id);
          setRouterOnline(true);
          if (dest !== false) navigate(dest ?? "/");
          return;
        }

        releaseDashboardFreshGate(id);
        markRouterOffline(id);
        setRouterOnline(false);
        setIsPingFailed(true);
        navigate("/");
      } finally {
        activeRef.current = false;
        setPingingId(null);
      }
    },
    [token, beginConnect, setRouterOnline, markRouterOffline, setIsPingFailed, navigate],
  );

  return { selectWithPing, connectFromRoutersPage, pingingId };
}
