import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getListRouterProfilesQueryKey } from "@workspace/api-client-react";
import type { HotspotProfile } from "@workspace/api-client-react";
import { sortRouterProfilesByCreationOrder } from "@/lib/routerProfilesSort";
import { useRouterContext } from "@/contexts/RouterContext";

export const ROUTER_PROFILES_CACHE_KEY = "generate-profiles-cache:v1";
export const FORFAITS_PROFILES_CACHE_KEY = "forfaits-cache";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function readRouterProfilesFromStorage(routerId: number): HotspotProfile[] | null {
  try {
    const fromGenerate = localStorage.getItem(`${ROUTER_PROFILES_CACHE_KEY}:${routerId}`);
    if (fromGenerate) {
      const parsed = JSON.parse(fromGenerate) as unknown;
      return Array.isArray(parsed) ? (parsed as HotspotProfile[]) : null;
    }
    const fromForfaits = localStorage.getItem(`${FORFAITS_PROFILES_CACHE_KEY}:${routerId}`);
    if (fromForfaits) {
      const parsed = JSON.parse(fromForfaits) as unknown;
      return Array.isArray(parsed) ? (parsed as HotspotProfile[]) : null;
    }
  } catch {
    // ignore
  }
  return null;
}

export function writeRouterProfilesToStorage(routerId: number, profiles: HotspotProfile[]): void {
  try {
    const json = JSON.stringify(profiles);
    localStorage.setItem(`${ROUTER_PROFILES_CACHE_KEY}:${routerId}`, json);
    localStorage.setItem(`${FORFAITS_PROFILES_CACHE_KEY}:${routerId}`, json);
  } catch {
    // ignore quota
  }
}

/**
 * Profils du routeur sélectionné — même stratégie que la page Générer :
 * cache localStorage d’abord, puis `/profiles?refresh=1` en arrière-plan.
 */
export function useRouterProfilesLive(routerId: number | null) {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [profiles, setProfiles] = useState<HotspotProfile[]>([]);
  const [profilesForRouterId, setProfilesForRouterId] = useState<number | null>(null);

  const profilesSorted = useMemo(() => {
    if (profilesForRouterId !== routerId) return [];
    return sortRouterProfilesByCreationOrder(profiles);
  }, [profiles, profilesForRouterId, routerId]);

  useEffect(() => {
    setProfiles([]);
    setProfilesForRouterId(null);
  }, [routerId]);

  useEffect(() => {
    if (!routerId) {
      setProfiles([]);
      setProfilesForRouterId(null);
      return;
    }
    const cached = readRouterProfilesFromStorage(routerId);
    if (cached?.length) {
      setProfiles(cached);
      setProfilesForRouterId(routerId);
    } else {
      setProfiles([]);
      setProfilesForRouterId(null);
    }
  }, [routerId]);

  useEffect(() => {
    if (!routerId) return;
    let cancelled = false;
    setRefreshing(true);
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/routers/${routerId}/profiles?refresh=1`);
        if (!res.ok || cancelled) return;
        const freshProfiles = (await res.json()) as HotspotProfile[];
        if (!Array.isArray(freshProfiles) || cancelled) return;
        setProfiles(freshProfiles);
        setProfilesForRouterId(routerId);
        writeRouterProfilesToStorage(routerId, freshProfiles);
        const profileKey = getListRouterProfilesQueryKey(routerId);
        queryClient.setQueryData(profileKey, freshProfiles);
        void queryClient.invalidateQueries({ queryKey: profileKey });
      } catch {
        // conserve le cache local si le refresh échoue
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    })();
    return () => {
      cancelled = true;
      setRefreshing(false);
    };
  }, [routerId, queryClient]);

  return {
    profiles: profilesSorted,
    refreshing,
    profilesForRouterId,
    ready: profilesForRouterId === routerId,
  };
}

export type RouterProfilesLiveValue = ReturnType<typeof useRouterProfilesLive>;

const RouterProfilesLiveContext = createContext<RouterProfilesLiveValue | null>(null);

/** Un seul chargement profils / routeur pour Layout, Générer, Ajouter un client, etc. */
export function RouterProfilesProvider({ children }: { children: ReactNode }) {
  const { selectedRouterId } = useRouterContext();
  const value = useRouterProfilesLive(selectedRouterId);
  return (
    <RouterProfilesLiveContext.Provider value={value}>
      {children}
    </RouterProfilesLiveContext.Provider>
  );
}

export function useSharedRouterProfiles(): RouterProfilesLiveValue {
  const ctx = useContext(RouterProfilesLiveContext);
  if (!ctx) {
    throw new Error("useSharedRouterProfiles doit être utilisé sous RouterProfilesProvider");
  }
  return ctx;
}
