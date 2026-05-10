import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getListRouterProfilesQueryKey } from "@workspace/api-client-react";
import type { HotspotProfile } from "@workspace/api-client-react";
import { useRouterContext } from "@/contexts/RouterContext";
import { shouldPrefetchRouterProfiles } from "@/lib/route-query-policy";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const PROFILES_CACHE_KEY = "generate-profiles-cache:v1";
const FORFAITS_PROFILES_CACHE_KEY = "forfaits-cache";

function persistProfilesLocal(routerId: number, profiles: HotspotProfile[]) {
  try {
    localStorage.setItem(`${PROFILES_CACHE_KEY}:${routerId}`, JSON.stringify(profiles));
    localStorage.setItem(`${FORFAITS_PROFILES_CACHE_KEY}:${routerId}`, JSON.stringify(profiles));
  } catch {
    /* quota exceeded — ignore */
  }
}

/**
 * Sur /generate et /forfaits :
 * - **Pas de snapshot SQL** pour le routeur → un GET `/profiles` (charge cache / MikroTik comme avant).
 * - **Snapshot SQL déjà présent** → GET `/profiles?refresh=1` : réponse immédiate depuis le cache RAM,
 *   synchronisation MikroTik en arrière-plan (détecte profils modifiés / supprimés), puis invalidation
 *   différée du cache React Query pour refléter la liste à jour.
 */
export function usePrefetchRouterProfiles(): void {
  const [location] = useLocation();
  const { selectedRouterId } = useRouterContext();
  const queryClient = useQueryClient();
  const inFlightRef = useRef<Set<number>>(new Set());
  /** `window.setTimeout` → `number` (DOM) ; évite le conflit NodeJS.Timeout / setTimeout global. */
  const invalidateAfterRefreshRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!shouldPrefetchRouterProfiles(location)) return;
    if (!selectedRouterId) return;

    const id = selectedRouterId;
    if (inFlightRef.current.has(id)) return;
    inFlightRef.current.add(id);

    void (async () => {
      try {
        const metaRes = await fetch(`${BASE}/api/routers/${id}/profiles/snapshot-meta`);
        const meta = (metaRes.ok ? await metaRes.json() : {}) as { hasSnapshot?: boolean };
        const hasSnapshot = meta.hasSnapshot === true;

        if (!hasSnapshot) {
          const res = await fetch(`${BASE}/api/routers/${id}/profiles`);
          if (!res.ok) return;
          const profiles = (await res.json()) as HotspotProfile[];
          if (!Array.isArray(profiles) || profiles.length === 0) return;
          persistProfilesLocal(id, profiles);
          queryClient.setQueryData(getListRouterProfilesQueryKey(id), profiles);
          return;
        }

        const res = await fetch(`${BASE}/api/routers/${id}/profiles?refresh=1`);
        if (!res.ok) return;
        const profiles = (await res.json()) as HotspotProfile[];
        if (!Array.isArray(profiles) || profiles.length === 0) return;
        persistProfilesLocal(id, profiles);
        queryClient.setQueryData(getListRouterProfilesQueryKey(id), profiles);

        if (invalidateAfterRefreshRef.current != null) {
          window.clearTimeout(invalidateAfterRefreshRef.current);
        }
        invalidateAfterRefreshRef.current = window.setTimeout(() => {
          invalidateAfterRefreshRef.current = undefined;
          void queryClient.invalidateQueries({ queryKey: getListRouterProfilesQueryKey(id) });
        }, 3000);
      } catch {
        /* routeur injoignable — réessai à la prochaine visite */
      } finally {
        inFlightRef.current.delete(id);
      }
    })();

    return () => {
      if (invalidateAfterRefreshRef.current != null) {
        window.clearTimeout(invalidateAfterRefreshRef.current);
        invalidateAfterRefreshRef.current = undefined;
      }
    };
  }, [selectedRouterId, queryClient, location]);
}
