import { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { useListRouters } from "@workspace/api-client-react";
import type { Router } from "@workspace/api-client-react";

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
});

const STORAGE_KEY = "vouchernet_router_id";

export function RouterProvider({ children }: { children: ReactNode }) {
  const { data: freshRouters, isLoading: routersLoading } = useListRouters({
    query: { staleTime: 30_000, gcTime: 5 * 60_000 },
  });

  const [routers, setRouters] = useState<Router[]>([]);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (freshRouters && freshRouters.length > 0) {
      setRouters(freshRouters);
      initializedRef.current = true;
    }
  }, [freshRouters]);

  const [selectedRouterId, setSelectedRouterIdState] = useState<number | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? parseInt(stored, 10) : null;
  });

  const [pingTrigger, setPingTrigger] = useState(0);
  const [routerOnline, setRouterOnline] = useState<boolean | null>(null);
  const [routerIdentity, setRouterIdentity] = useState<string | null>(null);

  const setSelectedRouterId = useCallback((id: number | null) => {
    setSelectedRouterIdState(id);
    if (id === null) {
      localStorage.removeItem(STORAGE_KEY);
      setRouterOnline(null);
      setRouterIdentity(null);
    } else {
      localStorage.setItem(STORAGE_KEY, String(id));
      // Trigger immediate data refresh — no ping needed
      setRouterOnline(null);
      setRouterIdentity(null);
      setPingTrigger((n) => n + 1);
    }
  }, []);

  useEffect(() => {
    if (routers.length === 1 && selectedRouterId === null) {
      setSelectedRouterId(routers[0].id);
    }
  }, [routers, selectedRouterId, setSelectedRouterId]);

  // On initial load, if a router is already stored, trigger a fetch immediately
  const didInitialTrigger = useRef(false);
  useEffect(() => {
    if (!didInitialTrigger.current && selectedRouterId) {
      didInitialTrigger.current = true;
      setPingTrigger((n) => n + 1);
    }
  }, [selectedRouterId]);

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
    }}>
      {children}
    </RouterContext.Provider>
  );
}

export function useRouterContext() {
  return useContext(RouterContext);
}
