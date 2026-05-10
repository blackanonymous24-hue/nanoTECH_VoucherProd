import { useEffect } from "react";
import { useLocation } from "wouter";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useRouterContext } from "@/contexts/RouterContext";
import { isDashboardPath } from "@/lib/route-query-policy";
import { useAuthQueryScope, withAuthQueryScope } from "@/lib/auth-query-scope";

function keyHasScopePrefix(key: QueryKey, scope: readonly unknown[]): boolean {
  if (key.length < scope.length) return false;
  for (let i = 0; i < scope.length; i++) {
    if (key[i] !== scope[i]) return false;
  }
  return true;
}

function scopedFirstSegment(key: QueryKey, scope: readonly unknown[]): unknown {
  return key[scope.length];
}

/**
 * Annule uniquement les requêtes React Query liées au **routeur actuellement sélectionné**
 * et à la **session / rôle** courants, quand la route change.
 */
export function useScopedRouteQueryCancel(): void {
  const [location] = useLocation();
  const { selectedRouterId } = useRouterContext();
  const qc = useQueryClient();
  const authScope = useAuthQueryScope();

  useEffect(() => {
    if (selectedRouterId == null) return;
    const id = selectedRouterId;
    const scope = authScope;
    const path = location.split("?")[0] || "/";
    const onDash = isDashboardPath(path);

    if (onDash) {
      void qc.cancelQueries({
        queryKey: withAuthQueryScope(scope, ["router-lots", id]),
        exact: true,
      });
      void qc.cancelQueries({
        queryKey: withAuthQueryScope(scope, ["router-ip-bindings", id]),
        exact: true,
      });
      void qc.cancelQueries({
        queryKey: withAuthQueryScope(scope, ["vendors-aliases", id]),
        exact: true,
      });
      void qc.cancelQueries({
        predicate: (q) => {
          if (!keyHasScopePrefix(q.queryKey, scope)) return false;
          const k = scopedFirstSegment(q.queryKey, scope);
          return (
            typeof k === "string"
            && k.startsWith(`/routers/${id}/`)
            && k.includes("/users")
            && !k.includes("/count")
          );
        },
      });
    } else {
      void qc.cancelQueries({
        queryKey: withAuthQueryScope(scope, ["router-dashboard-priority", id]),
        exact: true,
      });
      void qc.cancelQueries({
        queryKey: withAuthQueryScope(scope, ["interfaces", id]),
        exact: false,
      });
      void qc.cancelQueries({
        queryKey: withAuthQueryScope(scope, ["traffic", id]),
        exact: false,
      });
      void qc.cancelQueries({
        predicate: (q) => {
          if (!keyHasScopePrefix(q.queryKey, scope)) return false;
          const k = scopedFirstSegment(q.queryKey, scope);
          return typeof k === "string" && k.startsWith(`/routers/${id}/`) && k.includes("/logs");
        },
      });
    }
  }, [location, selectedRouterId, qc, authScope]);
}
