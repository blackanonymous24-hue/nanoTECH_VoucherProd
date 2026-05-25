/**
 * Caches localStorage scopés par routeur, utilisés pour l'affichage instantané
 * (style MikHmon) au changement de routeur ou de page.
 *
 * Ces caches sont volontairement persistés entre les navigations *au sein* d'une
 * même session. Mais ils doivent être purgés à la déconnexion (manuelle ou
 * automatique via session revoked / idle logout) et à la prochaine connexion,
 * sinon l'utilisateur revient sur le tableau de bord et voit pendant quelques
 * secondes des chiffres datant de plusieurs minutes (le temps que le fetch HTTP
 * frais remplace `initialData` / `placeholderData`).
 *
 * Le format des clés est `<prefix><routerId>` ou `<prefix><routerId>:...`.
 */
const ROUTER_SCOPED_CACHE_PREFIXES = [
  "dashboard-priority-cache:",
  "vouchernet-dashboard-logs-cache:",
  "sessions-cache:",
  "ip-bindings-cache:",
  "dhcp-leases-cache:",
  "hotspot-cookies-cache:",
  "reports-summary-cache:",
  "generate-profiles-cache:",
  "forfaits-cache:",
];

/**
 * Supprime toutes les entrées localStorage liées à l'état temps réel d'un
 * routeur. À appeler au logout et au login pour garantir que le premier clic
 * sur un routeur déclenche un vrai fetch côté MikroTik (et pas un réaffichage
 * de chiffres potentiellement vieux de plusieurs minutes).
 */
export function clearRouterScopedClientCaches(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (ROUTER_SCOPED_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        keysToRemove.push(key);
      }
    }
    for (const k of keysToRemove) {
      localStorage.removeItem(k);
    }
  } catch {
    /* private mode / quota — ignore */
  }
}
