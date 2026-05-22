/** Port API RouterOS par défaut (Mikhmon). */
export const DEFAULT_ROUTER_API_PORT = 8728;

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
