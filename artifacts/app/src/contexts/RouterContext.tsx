import { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { useListRouters, getListRoutersQueryKey } from "@workspace/api-client-react";
import type { Router } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import { queryClient } from "@/lib/queryClient";
import {
  prefetchRouterDashboardPriority,
} from "@/lib/prefetch-router-dashboard-priority";
import { prefetchRouterSessions } from "@/lib/prefetch-router-sessions";
import { useRouterTcpPing } from "@/hooks/use-router-tcp-ping";
import { openDashboardFreshGate, beginRouterConnectFreshEpoch, getRouterConnectFreshEpoch } from "@/lib/dashboard-resume";
import { clearRouterScopedClientCaches } from "@/lib/router-client-cache";

/**
 * Tolérance d'âge du cache au changement de routeur (sélecteur ou page Routeurs) :
 * - cache <= 1 min → affichage instantané + refetch `fresh=1` en arrière-plan
 * - cache  > 1 min → purge localStorage + queryClient, puis fetch frais
 */

export type BorrowedRouter = {
  id: number;
  name: string;
  ownerAdminId: number;
  host?: string;
  port?: number;
  hotspotName?: string | null;
  contact?: string | null;
  currency?: string | null;
};

interface RouterContextValue {
  selectedRouterId: number | null;
  setSelectedRouterId: (id: number | null) => void;
  selectedRouter: Router | undefined;
  routers: Router[];
  routersLoading: boolean;
  pingTrigger: number;
  routerOnline: boolean | null;
  setRouterOnline: (online: boolean) => void;
  routerIdentity: string | null;
  setRouterIdentity: (identity: string | null) => void;
  isRouterLocked: boolean;
  isPingFailed: boolean;
  setIsPingFailed: (v: boolean) => void;
  /** Triplet ping en cours — masquer les caches MikroTik stale. */
  isPingChecking: boolean;
  setIsPingChecking: (v: boolean) => void;
  /** 3 pings échoués : hors ligne, purge cache, page erreur. */
  confirmRouterOffline: (id: number) => void;
  /** Badge « Hors ligne » sur la page Routeurs après échec ping sélecteur. */
  offlineMarkedRouterId: number | null;
  markRouterOffline: (id: number) => void;
  clearRouterOfflineMark: () => void;
  /** Routeur d'un autre tenant connecté temporairement par le super-admin */
  borrowedRouter: BorrowedRouter | null;
  setBorrowedRouter: (r: BorrowedRouter | null) => void;
  /** Évite un double triplet quand useSelectRouterWithPing gère déjà le ping. */
  skipNextTcpPingInitialRef: React.MutableRefObject<boolean>;
}

const RouterContext = createContext<RouterContextValue>({
  selectedRouterId: null,
  setSelectedRouterId: () => {},
  selectedRouter: undefined,
  routers: [],
  routersLoading: false,
  pingTrigger: 0,
  routerOnline: null,
  setRouterOnline: () => {},
  routerIdentity: null,
  setRouterIdentity: () => {},
  isRouterLocked: false,
  isPingFailed: false,
  setIsPingFailed: () => {},
  isPingChecking: false,
  setIsPingChecking: () => {},
  confirmRouterOffline: () => {},
  offlineMarkedRouterId: null,
  markRouterOffline: () => {},
  clearRouterOfflineMark: () => {},
  borrowedRouter: null,
  setBorrowedRouter: () => {},
  skipNextTcpPingInitialRef: { current: false },
});

const STORAGE_KEY = "vouchernet_router_id";
const BORROWED_ROUTER_KEY = "vouchernet_borrowed_router";
const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function RouterProvider({ children }: { children: ReactNode }) {
  const { managerRouterIds, role, collaborateurRouterIds, isAuthenticated } = useAuth();
  // Gérants et collaborateurs : liste filtrée, sélecteur libre entre routeurs assignés.
  const isRouterLocked = false;

  const { data: freshRouters, isLoading: routersQueryLoading, isFetched: routersFetched } = useListRouters({
    query: { queryKey: getListRoutersQueryKey(), staleTime: 30_000, gcTime: 5 * 60_000 },
  });

  // Use freshRouters directly — no intermediate state — so that when
  // routersFetched becomes true, `routers` is already the real list.
  // The previous pattern (setAllRouters in a useEffect) caused a one-render
  // lag where routersFetched=true but allRouters=[], which wiped the stored
  // selectedRouterId and fell back to the first router on every refresh.
  const allRouters: Router[] = freshRouters ?? [];

  const routers: Router[] =
    role === "collaborateur"
      ? allRouters
      : role === "manager" && managerRouterIds.length > 0
        ? allRouters.filter((r) => managerRouterIds.includes(r.id))
        : allRouters;

  const [selectedRouterId, setSelectedRouterIdState] = useState<number | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? parseInt(stored, 10) : null;
  });

  const [pingTrigger, setPingTrigger] = useState(0);
  const [routerOnline, setRouterOnline] = useState<boolean | null>(null);
  const [routerIdentity, setRouterIdentity] = useState<string | null>(null);
  const skipNextTcpPingInitialRef = useRef(false);

  const [isPingFailed, setIsPingFailed] = useState(false);
  const [isPingChecking, setIsPingChecking] = useState(false);
  const [offlineMarkedRouterId, setOfflineMarkedRouterId] = useState<number | null>(null);

  const markRouterOffline = useCallback((id: number) => {
    setOfflineMarkedRouterId(id);
    setRouterOnline(false);
  }, []);

  const confirmRouterOffline = useCallback((id: number) => {
    setOfflineMarkedRouterId(id);
    setRouterOnline(false);
    setIsPingFailed(true);
    setIsPingChecking(false);
    clearRouterScopedClientCaches(id);
    void queryClient.resetQueries({
      queryKey: ["router-dashboard-priority", id],
      exact: true,
    });
  }, []);

  const clearRouterOfflineMark = useCallback(() => {
    setOfflineMarkedRouterId(null);
  }, []);
  // Déclaré AVANT l'effet d'alignement pour éviter la temporal dead zone.
  // Initialisé depuis localStorage pour survivre aux refreshs de page.
  const [borrowedRouter, setBorrowedRouter] = useState<BorrowedRouter | null>(() => {
    try {
      const stored = localStorage.getItem(BORROWED_ROUTER_KEY);
      const parsed = stored ? (JSON.parse(stored) as BorrowedRouter) : null;
      // Initialisation synchrone avant le premier fetch React Query
      (window as { __vouchernetImpersonateAdminId?: number | null }).__vouchernetImpersonateAdminId =
        parsed?.ownerAdminId ?? null;
      return parsed;
    } catch {
      return null;
    }
  });
  const borrowedRouterRef = useRef<BorrowedRouter | null>(null);
  useEffect(() => {
    borrowedRouterRef.current = borrowedRouter;
    // Expose le ownerAdminId pour que installAuthFetch puisse injecter
    // le header X-Impersonate-Admin sur tous les appels API.
    (window as { __vouchernetImpersonateAdminId?: number | null }).__vouchernetImpersonateAdminId =
      borrowedRouter?.ownerAdminId ?? null;
    // Persiste le routeur emprunté pour survivre aux refreshs de page.
    try {
      if (borrowedRouter) {
        localStorage.setItem(BORROWED_ROUTER_KEY, JSON.stringify(borrowedRouter));
      } else {
        localStorage.removeItem(BORROWED_ROUTER_KEY);
      }
    } catch { /* noop */ }
  }, [borrowedRouter]);

  // Sessions empruntées avant l'ajout de host/port au cache local : compléter via l'API.
  useEffect(() => {
    if (!borrowedRouter?.id || borrowedRouter.host?.trim()) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/routers/${borrowedRouter.id}`);
        if (!res.ok || cancelled) return;
        const row = (await res.json()) as {
          host?: string;
          port?: number;
          name?: string;
          hotspotName?: string | null;
          contact?: string | null;
          currency?: string | null;
          ownerAdminId?: number | null;
        };
        if (cancelled || !row.host?.trim()) return;
        setBorrowedRouter((prev) => {
          if (!prev || prev.id !== borrowedRouter.id) return prev;
          return {
            ...prev,
            host: row.host,
            port: row.port ?? prev.port,
            name: row.name ?? prev.name,
            hotspotName: row.hotspotName ?? prev.hotspotName,
            contact: row.contact ?? prev.contact,
            currency: row.currency ?? prev.currency,
            ownerAdminId: row.ownerAdminId ?? prev.ownerAdminId,
          };
        });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [borrowedRouter?.id, borrowedRouter?.host]);

  // Quand la liste des routeurs autorisés est connue : aligner la sélection.
  // - liste vide → effacer l'ID SAUF si c'est un routeur emprunté
  //   (super-admin connecté au routeur d'un autre tenant).
  // - sélection absente de la liste → premier routeur autorisé.
  //
  // IMPORTANT : on utilise `borrowedRouter` (state) plutôt que
  // `borrowedRouterRef.current` pour éviter une race condition : le ref
  // est mis à jour dans un useEffect (un render plus tard), donc si
  // setSelectedRouterId et setBorrowedRouter sont appelés dans le même
  // cycle, le ref vaut encore null quand cet effet s'exécute.
  useEffect(() => {
    if (!isAuthenticated) return;
    if (!routersFetched) return;

    if (routers.length === 0) {
      // Ne pas effacer si le routeur sélectionné est un routeur emprunté
      const isBorrowed = selectedRouterId !== null
        && borrowedRouter?.id === selectedRouterId;
      if (selectedRouterId !== null && !isBorrowed) {
        setSelectedRouterIdState(null);
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          /* noop */
        }
      }
      return;
    }

    const isBorrowed = selectedRouterId !== null
      && borrowedRouter?.id === selectedRouterId;
    if (!isBorrowed && (selectedRouterId === null || !routers.some((r) => r.id === selectedRouterId))) {
      const firstId = routers[0].id;
      setSelectedRouterIdState(firstId);
      localStorage.setItem(STORAGE_KEY, String(firstId));
    }
  }, [isAuthenticated, routersFetched, routers, selectedRouterId, borrowedRouter]);

  // Préchauffe uniquement après ping TCP confirmé en ligne.
  useEffect(() => {
    if (!isAuthenticated || selectedRouterId == null || routerOnline !== true) return;
    void prefetchRouterDashboardPriority(selectedRouterId);
    prefetchRouterSessions(selectedRouterId);
  }, [isAuthenticated, selectedRouterId, routerOnline]);

  const setSelectedRouterId = useCallback((id: number | null) => {
    if (isRouterLocked) return; // Hard-locked: ignore changes
    if (id != null) openDashboardFreshGate(id);
    setSelectedRouterIdState(id);
    setIsPingFailed(false);
    if (id != null) setOfflineMarkedRouterId((prev) => (prev === id ? prev : null));
    if (id === null) {
      localStorage.removeItem(STORAGE_KEY);
      setBorrowedRouter(null);
      setRouterOnline(null);
      setRouterIdentity(null);
    } else {
      // Toujours persister l'ID sélectionné (y compris les routeurs empruntés)
      // pour que le refresh de page restaure la même session.
      localStorage.setItem(STORAGE_KEY, String(id));
      const isOwnRouter = allRouters.some((r) => r.id === id);
      if (isOwnRouter) {
        setBorrowedRouter(null); // sélection d'un routeur propre → efface le routeur emprunté
      }
      setRouterOnline(null);
      // Pre-seed identity from DB data so the sidebar is never empty while
      // the MikroTik /info call is in-flight. The real identity replaces it.
      const dbRouter = allRouters.find((r) => r.id === id)
        ?? (borrowedRouterRef.current?.id === id ? borrowedRouterRef.current : null);
      setRouterIdentity(dbRouter?.name ?? null);
      setPingTrigger((n) => n + 1);
    }
  }, [isRouterLocked, allRouters]);

  // On initial load, if a router is already stored, trigger a fetch immediately
  const didInitialTrigger = useRef(false);
  useEffect(() => {
    if (!didInitialTrigger.current && selectedRouterId) {
      didInitialTrigger.current = true;
      setPingTrigger((n) => n + 1);
    }
  }, [selectedRouterId]);

  // Annuler les requêtes de l'ancien routeur au changement (sans reset — beginConnect gère le fresh).
  const prevRouterIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isAuthenticated || selectedRouterId == null) return;

    const prevId = prevRouterIdRef.current;
    prevRouterIdRef.current = selectedRouterId;
    if (prevId === selectedRouterId || prevId == null) return;

    void queryClient.cancelQueries({
      queryKey: ["router-dashboard-priority", prevId],
    });
  }, [selectedRouterId, isAuthenticated]);

  // Refresh page / auto-sélection : fresh epoch + prefetch si pas déjà lancé par beginConnect.
  useEffect(() => {
    if (!isAuthenticated || selectedRouterId == null) return;
    if (getRouterConnectFreshEpoch(selectedRouterId) > 0) return;
    beginRouterConnectFreshEpoch(selectedRouterId);
    void prefetchRouterDashboardPriority(selectedRouterId, { fresh: true, wait: true });
  }, [isAuthenticated, selectedRouterId]);

  // Removed aggressive bootstrap prewarm to keep MikroTik traffic focused on
  // the currently open page actions and avoid background contention.

  // When the router list arrives from the DB, immediately seed routerIdentity
  // from the stored name so the sidebar never shows a blank/generic label.
  const didSeedIdentity = useRef(false);
  useEffect(() => {
    if (didSeedIdentity.current) return;
    if (!selectedRouterId || allRouters.length === 0) return;
    const dbRouter = allRouters.find((r) => r.id === selectedRouterId);
    if (dbRouter) {
      didSeedIdentity.current = true;
      setRouterIdentity((prev) => prev ?? dbRouter.name ?? null);
    }
  }, [allRouters, selectedRouterId]);

  // Ping TCP MikHmon (fsockopen 3 s) — seule source du badge En ligne / Hors ligne.
  useRouterTcpPing(isAuthenticated ? selectedRouterId : null);

  // selectedRouter : cherche d'abord dans les routeurs propres, puis dans borrowedRouter
  const selectedRouter: Router | undefined =
    routers.find((r) => r.id === selectedRouterId)
    ?? (borrowedRouter?.id === selectedRouterId
      ? (borrowedRouter as unknown as Router)
      : undefined);

  // isFirstLoad: true only while the very first fetch is in-flight (no cached data yet)
  const isFirstLoad = routersQueryLoading && freshRouters == null;

  return (
    <RouterContext.Provider value={{
      selectedRouterId,
      setSelectedRouterId,
      selectedRouter,
      routers,
      routersLoading: isFirstLoad,
      pingTrigger,
      routerOnline,
      setRouterOnline,
      routerIdentity,
      setRouterIdentity,
      isRouterLocked,
      isPingFailed,
      setIsPingFailed,
      isPingChecking,
      setIsPingChecking,
      confirmRouterOffline,
      offlineMarkedRouterId,
      markRouterOffline,
      clearRouterOfflineMark,
      borrowedRouter,
      setBorrowedRouter,
      skipNextTcpPingInitialRef,
    }}>
      {children}
    </RouterContext.Provider>
  );
}

export function useRouterContext() {
  return useContext(RouterContext);
}
