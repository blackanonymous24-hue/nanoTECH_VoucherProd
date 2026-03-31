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

const WIN1252_REVERSE: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
};

function fixEncoding(str: string): string {
  try {
    const bytes: number[] = [];
    for (const ch of str) {
      const code = ch.codePointAt(0)!;
      if (code <= 0x7f) {
        bytes.push(code);
      } else if (WIN1252_REVERSE[code] !== undefined) {
        bytes.push(WIN1252_REVERSE[code]);
      } else if (code <= 0xff) {
        bytes.push(code);
      } else {
        return str;
      }
    }
    const decoded = Buffer.from(bytes).toString("utf-8");
    return decoded.includes("\uFFFD") ? str : decoded;
  } catch {
    return str;
  }
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
  timeout = 15000,
): Promise<T> {
  const api = new RouterOSAPI({
    host: conn.host,
    port: conn.port,
    user: conn.username,
    password: conn.password,
    timeout,
  });

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("RouterOS operation timed out")), timeout),
  );

  await api.connect();
  try {
    return await Promise.race([fn(api), timeoutPromise]);
  } finally {
    try { api.close(); } catch { /* ignore close errors */ }
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
        name: fixEncoding((p["name"] as string) ?? ""),
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

export interface HotspotUser {
  username: string;
  password: string;
  profile: string;
  comment: string | null;
  limitUptime: string | null;
  limitBytesTotal: string | null;
  macAddress: string | null;
  server: string | null;
  disabled: boolean;
}

export async function listHotspotUsers(conn: RouterConnection, timeout = 15000): Promise<HotspotUser[]> {
  return withRouter(conn, async (api) => {
    const users = await api.write("/ip/hotspot/user/print");
    return users.map((u) => ({
      username: fixEncoding((u["name"] as string) ?? ""),
      password: (u["password"] as string) ?? "",
      profile: fixEncoding((u["profile"] as string) ?? ""),
      comment: fixEncoding((u["comment"] as string) || null) || null,
      limitUptime: (u["limit-uptime"] as string) || null,
      limitBytesTotal: (u["limit-bytes-total"] as string) || null,
      macAddress: (u["mac-address"] as string) || null,
      server: (u["server"] as string) || null,
      disabled: (u["disabled"] as string) === "true",
    }));
  }, timeout);
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

export interface LogEntry {
  id: string;
  time: string;
  topics: string;
  message: string;
}

export async function listLogs(conn: RouterConnection, limit = 50): Promise<LogEntry[]> {
  return withRouter(conn, async (api) => {
    const entries = await api.write("/log/print");
    return entries
      .slice(-limit)
      .reverse()
      .map((e) => ({
        id: (e[".id"] as string) ?? "",
        time: (e["time"] as string) ?? "",
        topics: (e["topics"] as string) ?? "",
        message: (e["message"] as string) ?? "",
      }));
  });
}

export async function disconnectSession(conn: RouterConnection, username: string): Promise<number> {
  return withRouter(conn, async (api) => {
    const sessions = await api.write("/ip/hotspot/active/print", [`?user=${username}`]);
    let removed = 0;
    for (const s of sessions) {
      const id = s[".id"] as string | undefined;
      if (id) {
        await api.write("/ip/hotspot/active/remove", [`=.id=${id}`]);
        removed++;
      }
    }
    return removed;
  });
}

function randomStr(length: number): string {
  const chars = "5ab2c34d";
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function generateCode(
  length: number,
  prefix: string | undefined,
  passwordMode: "same" | "random",
): { username: string; password: string } {
  const code = randomStr(length);
  const username = prefix ? `${prefix}${code}` : code;
  const password = passwordMode === "same" ? username : randomStr(length);
  return { username, password };
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
    passwordMode?: "same" | "random";
  },
): Promise<GeneratedVoucher[]> {
  return withRouter(conn, async (api) => {
    const generated: GeneratedVoucher[] = [];

    for (let i = 0; i < opts.qty; i++) {
      const { username, password } = generateCode(opts.prefix ? 5 : 8, opts.prefix, opts.passwordMode ?? "random");
      const addParams: string[] = [
        `=name=${username}`,
        `=password=${password}`,
        `=profile=${opts.profile}`,
      ];
      if (opts.comment) {
        addParams.push(`=comment=${opts.comment}`);
      }
      if (opts.server) {
        addParams.push(`=server=${opts.server}`);
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
  }, 120_000);
}
