import type { QueryKey } from "@tanstack/react-query";

/**
 * Préfixes connus : `[prefix, routerId, ...]` (éventuellement après un préfixe auth `vn1`…).
 */
const ROUTER_TUPLED_PREFIXES = new Set<string>([
  "router-lots",
  "router-ip-bindings",
  "vendors-aliases",
  "router-dashboard-priority",
  "interfaces",
  "traffic",
  "vendors-nav-count",
  "stock-alerts",
  "vendors",
  "router-profiles-dialog",
  "router-hotspot-servers-dialog",
  "router-users-count",
  "vendor-tracking",
  "vendor-tracking-prevweek",
  "vendor-daily-arrears",
  "sold-lookup",
  "vendors-summary",
  "weekly-summary",
  "weekly-daily-payments",
  "daily-arrears-versement",
]);

/**
 * Indique si une clé React Query est **explicitement** liée à ce routeur.
 * (Évite `queryKey.includes(routerId)` qui annule aussi les clés où `routerId`
 * apparaît comme ID vendeur, indice, etc.)
 */
export function queryKeyBelongsToRouterId(key: QueryKey, routerId: number): boolean {
  if (!Number.isFinite(routerId)) return false;
  const routerPathRe = new RegExp(`^/routers/${routerId}(/|$)`);
  for (const seg of key) {
    if (typeof seg === "string" && routerPathRe.test(seg)) return true;
  }
  for (let i = 0; i < key.length - 1; i++) {
    const a = key[i];
    const b = key[i + 1];
    if (typeof a === "string" && ROUTER_TUPLED_PREFIXES.has(a) && b === routerId) return true;
  }
  if (
    key.length >= 2
    && key[0] === "/vendors/reports/summary"
    && key[1] === routerId
  ) {
    return true;
  }
  return false;
}
