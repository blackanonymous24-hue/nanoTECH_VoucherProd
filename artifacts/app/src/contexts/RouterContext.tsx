import { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { useListRouters, getListRoutersQueryKey } from "@workspace/api-client-react";
import type { Router } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import { queryClient } from "@/lib/queryClient";
import { prefetchRouterDashboardPriority } from "@/lib/prefetch-router-dashboard-priority";

export type BorrowedRouter = { id: number; name: string; ownerAdminId: number; hotspotName?: string | null; contact?: string | null };

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
  /** Routeur d'un autre tenant connecté temporairement par le super-admin */
  borrowedRouter: BorrowedRouter | null;
  setBorrowedRouter: (r: BorrowedRouter | null) => void;
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
  borrowedRouter: null,
  setBorrowedRouter: () => {},
});

const STORAGE_KEY = "vouchernet_router_id";
const BORROWED_ROUTER_KEY = "vouchernet_borrowed_router";

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
    role === "collaborateur" && collaborateurRouterIds.length > 0
      ? allRouters.filter((r) => collaborateurRouterIds.includes(r.id))
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
  const [isPingFailed, setIsPingFailed] = useState(false);
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

  const setSelectedRouterId = useCallback((id: number | null) => {
    if (isRouterLocked) return; // Hard-locked: ignore changes
    setSelectedRouterIdState(id);
    setIsPingFailed(false); // reset on every router change
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
      void prefetchRouterDashboardPriority(id);
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

  // Annuler toutes les requêtes en cours de l'ancien routeur quand on change.
  // Évite que des réponses tardives d'un router A polluent l'affichage du router B.
  const prevRouterIdRef = useRef<number | null>(selectedRouterId);
  useEffect(() => {
    const prevId = prevRouterIdRef.current;
    prevRouterIdRef.current = selectedRouterId;
    if (prevId === null || prevId === selectedRouterId) return;
    // Annuler toutes les queries dont la clé contient l'ancien router ID
    void queryClient.cancelQueries({
      predicate: (query) => query.queryKey.includes(prevId),
    });
  }, [selectedRouterId]);

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
      borrowedRouter,
      setBorrowedRouter,
    }}>
      {children}
    </RouterContext.Provider>
  );
}

export function useRouterContext() {
  return useContext(RouterContext);
}
