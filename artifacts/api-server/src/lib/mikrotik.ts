import { RouterOSAPI } from "node-routeros";

export interface RouterConnection {
  host: string;
  port: number;
  username: string;
  password: string;
}

export interface HotspotProfile {
  name: string;
  rateLimit: string | null;
  validity: string | null;
  price: string | null;
  sharedUsers: string | null;
  addrPool: string | null;
  lockMac: boolean;
}

export interface HotspotSession {
  user: string;
  address: string;
  macAddress: string | null;
  uptime: string;
  bytesIn: string | null;
  bytesOut: string | null;
  server: string | null;
}

export interface RouterBoardInfo {
  model: string;
  version: string;
}

function parseProfileOnLogin(onLogin: string): { price: string; validity: string; lockMac: boolean } {
  const parts = onLogin.split(",");
  const price = (parts[2] ?? "").trim();
  const validity = (parts[3] ?? "").trim();
  const lockField = (parts[6] ?? "").trim();
  const lockMac = lockField !== "" && !lockField.startsWith(";");
  return { price, validity, lockMac };
}

export async function withRouter<T>(
  conn: RouterConnection,
  fn: (api: RouterOSAPI) => Promise<T>,
  timeout = 10000,
): Promise<T> {
  const api = new RouterOSAPI({
    host: conn.host,
    port: conn.port,
    user: conn.username,
    password: conn.password,
    timeout,
  });

  await api.connect();
  try {
    return await fn(api);
  } finally {
    api.close();
  }
}

export async function testConnection(conn: RouterConnection): Promise<{ success: boolean; message: string; routerBoard: string | null; version: string | null }> {
  try {
    return await withRouter(conn, async (api) => {
      const [board] = await api.write("/system/routerboard/print");
      const [res] = await api.write("/system/resource/print");
      return {
        success: true,
        message: "Connexion établie",
        routerBoard: (board?.["model"] as string) ?? null,
        version: (res?.["version"] as string) ?? null,
      };
    });
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : "Erreur de connexion",
      routerBoard: null,
      version: null,
    };
  }
}

export async function listProfiles(conn: RouterConnection): Promise<HotspotProfile[]> {
  return withRouter(conn, async (api) => {
    const profiles = await api.write("/ip/hotspot/user/profile/print");
    return profiles.map((p) => {
      const onLogin = (p["on-login"] as string) ?? "";
      const parsed = onLogin.includes(",") ? parseProfileOnLogin(onLogin) : { price: "", validity: "", lockMac: false };
      return {
        name: (p["name"] as string) ?? "",
        rateLimit: (p["rate-limit"] as string) || null,
        validity: parsed.validity || null,
        price: parsed.price || null,
        sharedUsers: (p["shared-users"] as string) || null,
        addrPool: (p["address-pool"] as string) || null,
        lockMac: parsed.lockMac,
      };
    });
  });
}

export async function listSessions(conn: RouterConnection): Promise<HotspotSession[]> {
  return withRouter(conn, async (api) => {
    const sessions = await api.write("/ip/hotspot/active/print");
    return sessions.map((s) => ({
      user: (s["user"] as string) ?? "",
      address: (s["address"] as string) ?? "",
      macAddress: (s["mac-address"] as string) || null,
      uptime: (s["uptime"] as string) ?? "00:00:00",
      bytesIn: (s["bytes-in"] as string) || null,
      bytesOut: (s["bytes-out"] as string) || null,
      server: (s["server"] as string) || null,
    }));
  });
}

function generateCode(length: number, prefix?: string): { username: string; password: string } {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const random = () =>
    Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  const code = random();
  const username = prefix ? `${prefix}${code}` : code;
  return { username, password: code };
}

export interface GeneratedVoucher {
  username: string;
  password: string;
  profile: string;
  price: string;
  validity: string;
  comment: string;
}

export async function generateVouchers(
  conn: RouterConnection,
  opts: {
    qty: number;
    profile: string;
    prefix?: string;
    comment?: string;
    server?: string;
    price: string;
    validity: string;
  },
): Promise<GeneratedVoucher[]> {
  return withRouter(conn, async (api) => {
    const generated: GeneratedVoucher[] = [];

    for (let i = 0; i < opts.qty; i++) {
      const { username, password } = generateCode(6, opts.prefix);
      const addParams: Record<string, string> = {
        name: username,
        password,
        profile: opts.profile,
      };
      if (opts.comment) {
        addParams["comment"] = opts.comment;
      }
      if (opts.server) {
        addParams["server"] = opts.server;
      }

      await api.write("/ip/hotspot/user/add", addParams);

      generated.push({
        username,
        password,
        profile: opts.profile,
        price: opts.price,
        validity: opts.validity,
        comment: opts.comment ?? "",
      });
    }

    return generated;
  });
}
