import { getListRouterSessionsQueryOptions } from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";

/** Préchauffe la liste clients actifs (cache API + React Query). */
export function prefetchRouterSessions(routerId: number): void {
  void queryClient.prefetchQuery(
    getListRouterSessionsQueryOptions(routerId, {
      query: { staleTime: 14_000 },
    }),
  );
}
