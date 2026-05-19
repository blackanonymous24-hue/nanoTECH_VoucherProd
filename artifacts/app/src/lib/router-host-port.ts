/**
 * Gestion de l’adresse routeur style Mikhmon (`iphost`).
 * @see attached_assets/ping-test_1778007054527.php — host:port optionnel, défaut 8728
 */

/** Port API RouterOS (connexion TCP sortante de l’app). */
export const DEFAULT_ROUTER_API_PORT = 8728;

/** Parse `iphost` saisi : `192.168.1.1` ou `203.0.113.1:23728`. */
export function parseMikhmonIpHost(iphost: string): { host: string; port: number } {
  const s = iphost.trim();
  if (!s) return { host: "", port: DEFAULT_ROUTER_API_PORT };
  const colonIdx = s.lastIndexOf(":");
  if (colonIdx > 0) {
    const portStr = s.slice(colonIdx + 1);
    if (/^\d+$/.test(portStr)) {
      const port = parseInt(portStr, 10);
      if (port >= 1 && port <= 65535) {
        return { host: s.slice(0, colonIdx).trim(), port };
      }
    }
  }
  return { host: s, port: DEFAULT_ROUTER_API_PORT };
}

/**
 * Valeur affichée dans le formulaire : IP seule si port 8728,
 * sinon `ip:port` (NAT / port forward personnalisé).
 */
export function formatMikhmonIpHostForForm(host: string, port: number): string {
  const h = host.trim();
  if (!h) return "";
  const p = port > 0 ? port : DEFAULT_ROUTER_API_PORT;
  if (p === DEFAULT_ROUTER_API_PORT) return h;
  return `${h}:${p}`;
}

/** Affichage liste / cartes routeur (même règle que le formulaire). */
export const formatRouterAddressDisplay = formatMikhmonIpHostForForm;
