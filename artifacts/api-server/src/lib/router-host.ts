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

/** Corrige host/port DB (évite `socket.connect(port, "ip:port")` qui échoue toujours). */
export function normalizeRouterHostPort(host: string, port: number): { host: string; port: number } {
  const parsed = parseMikhmonIpHost(host);
  if (parsed.host) {
    return {
      host: parsed.host,
      port: parsed.port > 0 ? parsed.port : (port > 0 ? port : DEFAULT_ROUTER_API_PORT),
    };
  }
  return {
    host: host.trim(),
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
