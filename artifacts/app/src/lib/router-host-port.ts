/** Port API RouterOS par défaut (connexion TCP). */
export const DEFAULT_ROUTER_API_PORT = 8728;

export function parseRouterApiPort(raw: string): number {
  const n = parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n < 1 || n > 65535) return DEFAULT_ROUTER_API_PORT;
  return n;
}

/** Valeurs initiales du formulaire à partir d’un routeur en base. */
export function routerHostPortFromRow(host: string, port: number): { host: string; port: string } {
  return {
    host: host.trim(),
    port: String(port > 0 ? port : DEFAULT_ROUTER_API_PORT),
  };
}

/** Si l’utilisateur colle « hôte:port » dans le champ hôte, sépare les deux champs. */
export function splitPastedRouterHost(raw: string): { host: string; port: string | null } {
  const s = raw.trim();
  const colonIdx = s.lastIndexOf(":");
  if (colonIdx > 0) {
    const portStr = s.slice(colonIdx + 1);
    if (/^\d+$/.test(portStr)) {
      return { host: s.slice(0, colonIdx).trim(), port: portStr };
    }
  }
  return { host: s, port: null };
}
