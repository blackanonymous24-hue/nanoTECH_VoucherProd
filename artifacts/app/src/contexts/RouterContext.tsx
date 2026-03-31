import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { useListRouters } from "@workspace/api-client-react";
import type { Router } from "@workspace/api-client-react";

interface RouterContextValue {
  selectedRouterId: number | null;
  setSelectedRouterId: (id: number | null) => void;
  selectedRouter: Router | undefined;
  routers: Router[];
}

const RouterContext = createContext<RouterContextValue>({
  selectedRouterId: null,
  setSelectedRouterId: () => {},
  selectedRouter: undefined,
  routers: [],
});

const STORAGE_KEY = "vouchernet_router_id";

export function RouterProvider({ children }: { children: ReactNode }) {
  const { data: routers = [] } = useListRouters();

  const [selectedRouterId, setSelectedRouterIdState] = useState<number | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? parseInt(stored, 10) : null;
  });

  const setSelectedRouterId = (id: number | null) => {
    setSelectedRouterIdState(id);
    if (id === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, String(id));
    }
  };

  useEffect(() => {
    if (routers.length === 1 && selectedRouterId === null) {
      setSelectedRouterId(routers[0].id);
    }
  }, [routers, selectedRouterId]);

  const selectedRouter = routers.find((r) => r.id === selectedRouterId);

  return (
    <RouterContext.Provider value={{ selectedRouterId, setSelectedRouterId, selectedRouter, routers }}>
      {children}
    </RouterContext.Provider>
  );
}

export function useRouterContext() {
  return useContext(RouterContext);
}
