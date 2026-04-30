import { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { useListRouters } from "@workspace/api-client-react";
import type { Router } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";

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
});

const STORAGE_KEY = "vouchernet_router_id";

export function RouterProvider({ children }: { children: ReactNode }) {
  const { managerRouterId, role, collaborateurRouterIds, isAuthenticated } = useAuth();
  const isManagerLocked = role === "manager" && managerRouterId != null;
  // A collaborateur is "locked" to their assigned routers (cannot see others).
  // The selector is NOT locked (they can switch between their assigned routers),
  // but the router list is filtered.
  const isRouterLocked = isManagerLocked;

  const { data: freshRouters, isLoading: routersLoading } = useListRouters({
    query: { staleTime: 30_000, gcTime: 5 * 60_000 },
  });

  const [allRouters, setAllRouters] = useState<Router[]>([]);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (freshRouters) {
      setAllRouters(freshRouters);
      initializedRef.current = true;
    }
  }, [freshRouters]);

  // For collaborateurs: filter to only their assigned routers
  const routers: Router[] = (role === "collaborateur" && collaborateurRouterIds.length > 0)
    ? allRouters.filter((r) => collaborateurRouterIds.includes(r.id))
    : allRouters;

  const [selectedRouterId, setSelectedRouterIdState] = useState<number | null>(() => {
    if (isManagerLocked) return managerRouterId;
    const stored = localStorage.getItem(STORAGE_KEY);
    const storedId = stored ? parseInt(stored, 10) : null;
    // If collaborateur, ensure stored router is in their list (may not be loaded yet — will sync in effect)
    return storedId;
  });

  // When a manager's assigned router changes (e.g. they re-login), sync the selection
  useEffect(() => {
    if (isManagerLocked && managerRouterId != null) {
      setSelectedRouterIdState(managerRouterId);
      localStorage.setItem(STORAGE_KEY, String(managerRouterId));
    }
  }, [isManagerLocked, managerRouterId]);

  // For collaborateurs: if the currently selected router is not in their list, auto-select the first one
  useEffect(() => {
    if (role === "collaborateur" && routers.length > 0) {
      if (selectedRouterId === null || !routers.find((r) => r.id === selectedRouterId)) {
        const firstId = routers[0].id;
        setSelectedRouterIdState(firstId);
        localStorage.setItem(STORAGE_KEY, String(firstId));
      }
    }
  }, [role, routers, selectedRouterId]);

  // For admin/vendor (and any non-manager unlocked role): if selection is
  // empty or stale after reconnect, auto-select the first available router.
  useEffect(() => {
    if (!isAuthenticated) return;
    if (isManagerLocked) return;
    if (role === "collaborateur") return; // handled above
    if (routers.length === 0) return;
    if (selectedRouterId === null || !routers.some((r) => r.id === selectedRouterId)) {
      const firstId = routers[0].id;
      setSelectedRouterIdState(firstId);
      localStorage.setItem(STORAGE_KEY, String(firstId));
    }
  }, [isAuthenticated, isManagerLocked, role, routers, selectedRouterId]);

  const [pingTrigger, setPingTrigger] = useState(0);
  const [routerOnline, setRouterOnline] = useState<boolean | null>(null);
  const [routerIdentity, setRouterIdentity] = useState<string | null>(null);

  const setSelectedRouterId = useCallback((id: number | null) => {
    if (isRouterLocked) return; // Hard-locked: ignore changes
    setSelectedRouterIdState(id);
    if (id === null) {
      localStorage.removeItem(STORAGE_KEY);
      setRouterOnline(null);
      setRouterIdentity(null);
    } else {
      localStorage.setItem(STORAGE_KEY, String(id));
      setRouterOnline(null);
      // Pre-seed identity from DB data so the sidebar is never empty while
      // the MikroTik /info call is in-flight. The real identity replaces it.
      const dbRouter = allRouters.find((r) => r.id === id);
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

  const selectedRouter = routers.find((r) => r.id === selectedRouterId);
  const isFirstLoad = routersLoading && !initializedRef.current;

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
    }}>
      {children}
    </RouterContext.Provider>
  );
}

export function useRouterContext() {
  return useContext(RouterContext);
}
