import { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { useListRouters } from "@workspace/api-client-react";
import type { Router } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface RouterContextValue {
  selectedRouterId: number | null;
  setSelectedRouterId: (id: number | null) => void;
  selectedRouter: Router | undefined;
  routers: Router[];
  routersLoading: boolean;
  pingTrigger: number;
  pinging: boolean;
  routerOnline: boolean | null;
  setRouterOnline: (online: boolean) => void;
}

const RouterContext = createContext<RouterContextValue>({
  selectedRouterId: null,
  setSelectedRouterId: () => {},
  selectedRouter: undefined,
  routers: [],
  routersLoading: false,
  pingTrigger: 0,
  pinging: false,
  routerOnline: null,
  setRouterOnline: () => {},
});

const STORAGE_KEY = "vouchernet_router_id";

export function RouterProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
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
  const [pinging, setPinging] = useState(false);
  const [routerOnline, setRouterOnline] = useState<boolean | null>(null);
  const pingAbortRef = useRef<AbortController | null>(null);

  const setSelectedRouterId = useCallback((id: number | null) => {
    setSelectedRouterIdState(id);
    if (id === null) {
      localStorage.removeItem(STORAGE_KEY);
      setRouterOnline(null);
    } else {
      localStorage.setItem(STORAGE_KEY, String(id));
    }
  }, []);

  useEffect(() => {
    if (!selectedRouterId) return;

    if (pingAbortRef.current) {
      pingAbortRef.current.abort();
    }
    const controller = new AbortController();
    pingAbortRef.current = controller;

    let cancelled = false;
    setPinging(true);
    setRouterOnline(null);

    fetch(`${BASE}/api/routers/${selectedRouterId}/ping`, {
      signal: controller.signal,
    })
      .then((res) => res.json())
      .then((result: { success: boolean }) => {
        if (cancelled) return;
        setPinging(false);
        if (result.success) {
          setRouterOnline(true);
          setPingTrigger((n) => n + 1);
        } else {
          setRouterOnline(false);
          const { dismiss } = toast({
            title: "Routeur hors ligne",
            description: "Impossible de joindre le routeur sélectionné.",
            variant: "destructive",
          });
          setTimeout(dismiss, 5000);
        }
      })
      .catch((err) => {
        if (cancelled || (err instanceof DOMException && err.name === "AbortError")) return;
        setPinging(false);
        setRouterOnline(false);
        const { dismiss } = toast({
          title: "Routeur hors ligne",
          description: "Impossible de joindre le routeur sélectionné.",
          variant: "destructive",
        });
        setTimeout(dismiss, 5000);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [selectedRouterId, toast]);

  useEffect(() => {
    if (routers.length === 1 && selectedRouterId === null) {
      setSelectedRouterId(routers[0].id);
    }
  }, [routers, selectedRouterId, setSelectedRouterId]);

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
      pinging,
      routerOnline,
      setRouterOnline,
    }}>
      {children}
    </RouterContext.Provider>
  );
}

export function useRouterContext() {
  return useContext(RouterContext);
}
