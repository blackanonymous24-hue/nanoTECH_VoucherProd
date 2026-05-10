/**
 * Politique de requêtes par route : limiter le travail réseau en parallèle
 * (ex. tableau de bord) en ne lançant que ce qui est utile à l’écran courant.
 */

/** Chemins considérés comme « tableau de bord » (KPI + logs + trafic). */
export function isDashboardPath(path: string): boolean {
  let p = path.split("?")[0] || "/";
  p = p.replace(/\/+$/, "") || "/";
  const lower = p.toLowerCase();
  return lower === "/" || lower === "/admin" || lower.startsWith("/dashboard");
}

/** Préchargement silencieux des profils MikroTik — utile surtout avant Générer / Forfaits. */
export function shouldPrefetchRouterProfiles(path: string): boolean {
  const p = path.split("?")[0] || "/";
  return p.startsWith("/generate") || p.startsWith("/forfaits");
}

/** Alertes stock dans la barre latérale — pas indispensable au premier rendu du dashboard. */
export function shouldFetchStockAlertsNav(path: string): boolean {
  return !isDashboardPath(path);
}

/** Liste vendeurs (menu) — le menu suppose « vendeurs » tant que la requête n’a pas répondu (UX). */
export function shouldFetchVendorsNavCount(path: string): boolean {
  return !isDashboardPath(path);
}
