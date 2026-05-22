/** Port API RouterOS par défaut (Mikhmon). */
export const DEFAULT_ROUTER_API_PORT = 8728;

/** Délai fsockopen Mikhmon (ping-test.php). */
export const MIKHMON_PING_TIMEOUT_MS = 5_000;

/** `iphost` se termine par `:port` numérique (comme explode(':', $iphost) en PHP). */
export function iphostHasExplicitPort(iphost: string): boolean {
  const s = iphost.trim();
  const colonIdx = s.lastIndexOf(":");
  if (colonIdx <= 0) return false;
  const portStr = s.slice(colonIdx + 1);
  if (!/^\d+$/.test(portStr)) return false;
  const p = parseInt(portStr, 10);
  return p >= 1 && p <= 65535;
}

/** Parse `192.168.1.1` ou `203.0.113.1:23728` (format Mikhmon iphost). */
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
 * Fusion host + port corps JSON (création / édition).
 * Si `iphost` contient `:port`, ce port prime (champ unique Mikhmon).
 * Sinon on garde le port SQL / corps (ex. `v1.mikroot.com` + colonne 2520).
 */
export function mergeMikhmonHostPort(
  hostInput: string,
  portFromBody?: number | null,
): { host: string; port: number } {
  const parsed = parseMikhmonIpHost(hostInput);
  if (!parsed.host) return { host: "", port: DEFAULT_ROUTER_API_PORT };
  if (iphostHasExplicitPort(hostInput)) return parsed;
  const bodyPort = portFromBody != null && portFromBody > 0 ? portFromBody : 0;
  return {
    host: parsed.host,
    port: bodyPort > 0 ? bodyPort : DEFAULT_ROUTER_API_PORT,
  };
}

/**
 * Corrige host/port DB.
 * - `v1.mikroot.com:2520` dans host → host + port extraits du suffixe.
 * - `v1.mikroot.com` + port 2520 en colonne → on garde le port SQL (ne pas forcer 8728).
 */
export function normalizeRouterHostPort(host: string, port: number): { host: string; port: number } {
  const s = host.trim();
  if (!s) {
    return { host: "", port: port > 0 ? port : DEFAULT_ROUTER_API_PORT };
  }
  const colonIdx = s.lastIndexOf(":");
  if (colonIdx > 0) {
    const portStr = s.slice(colonIdx + 1);
    if (/^\d+$/.test(portStr)) {
      const parsedPort = parseInt(portStr, 10);
      if (parsedPort >= 1 && parsedPort <= 65535) {
        return { host: s.slice(0, colonIdx).trim(), port: parsedPort };
      }
    }
  }
  return {
    host: s,
    port: port > 0 ? port : DEFAULT_ROUTER_API_PORT,
  };
}

export function normalizeRouterConnection(conn: {
  host: string;
  port: number;
  username: string;
  password: string;
}): { host: string; port: number; username: string; password: string } {
  const { host, port } = normalizeRouterHostPort(conn.host, conn.port);
  return {
    host,
    port,
    username: conn.username?.trim() || "admin",
    password: conn.password ?? "",
  };
}
