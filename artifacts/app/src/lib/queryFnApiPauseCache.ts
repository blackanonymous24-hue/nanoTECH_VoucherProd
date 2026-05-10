import type { QueryFunction, QueryFunctionContext } from "@tanstack/react-query";
import { isApiPausedAbortError } from "@workspace/api-client-react";

/**
 * Enveloppe un `queryFn` React Query : si la pause API (toggle hotspot / génération)
 * annule la requête (`api-paused`), renvoie les données déjà en cache pour cette clé
 * au lieu d’échouer — évite les fausses pages « routeur inaccessible ».
 */
export function withApiPauseCacheFallback<TData>(
  fetcher: QueryFunction<TData>,
): QueryFunction<TData> {
  return async (ctx: QueryFunctionContext) => {
    try {
      return await fetcher(ctx);
    } catch (e) {
      if (isApiPausedAbortError(e)) {
        const prev = ctx.client.getQueryData<TData>(ctx.queryKey);
        if (prev !== undefined) return prev;
      }
      throw e;
    }
  };
}
