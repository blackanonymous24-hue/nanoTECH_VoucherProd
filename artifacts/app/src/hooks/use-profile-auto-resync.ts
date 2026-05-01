import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getListRouterProfilesQueryKey } from "@workspace/api-client-react";

type ProfileAutoResyncOptions = {
  intervalMs?: number;
  refreshProfiles?: boolean;
  syncNames?: boolean;
};

/**
 * Silent background resync for profile-driven pages.
 * - refreshProfiles: forces a live /profiles?refresh=1 pull
 * - syncNames: triggers server-side profile rename reconciliation
 */
export function useProfileAutoResync(
  routerId: number | null | undefined,
  options: ProfileAutoResyncOptions = {},
) {
  const queryClient = useQueryClient();
  const {
    intervalMs = 5 * 60_000,
    refreshProfiles = true,
    syncNames = true,
  } = options;

  useEffect(() => {
    if (!routerId) return;
    let cancelled = false;
    let inFlight = false;

    const run = async () => {
      if (inFlight || cancelled) return;
      inFlight = true;
      try {
        if (syncNames) {
          await fetch(`/api/routers/${routerId}/profiles/sync-names`, { method: "POST" }).catch(() => undefined);
        }
        if (refreshProfiles) {
          const res = await fetch(`/api/routers/${routerId}/profiles?refresh=1`);
          if (res.ok && !cancelled) {
            const freshProfiles = await res.json();
            const profileKey = getListRouterProfilesQueryKey(routerId);
            queryClient.setQueryData(profileKey, freshProfiles);
            queryClient.invalidateQueries({ queryKey: profileKey });
          }
        } else {
          const profileKey = getListRouterProfilesQueryKey(routerId);
          queryClient.invalidateQueries({ queryKey: profileKey });
        }
      } catch {
        // Keep current cache if background sync fails.
      } finally {
        inFlight = false;
      }
    };

    void run();
    const timer = window.setInterval(() => { void run(); }, Math.max(30_000, intervalMs));
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [routerId, intervalMs, refreshProfiles, syncNames, queryClient]);
}
