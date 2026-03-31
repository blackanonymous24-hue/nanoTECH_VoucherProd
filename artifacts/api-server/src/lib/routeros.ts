import { RouterOSAPI } from "node-routeros";

export interface RouterOSConfig {
  enabled: boolean;
  host: string;
  port: number;
  ssl: boolean;
  user: string;
  password: string;
}

const DEFAULT_CONFIG: RouterOSConfig = {
  enabled: false,
  host: "192.168.88.1",
  port: 8728,
  ssl: false,
  user: "admin",
  password: "",
};

export function parseConfig(raw: Record<string, string | null | undefined>): RouterOSConfig {
  return {
    enabled: raw["routeros.enabled"] === "true",
    host: raw["routeros.host"] ?? DEFAULT_CONFIG.host,
    port: parseInt(raw["routeros.port"] ?? String(DEFAULT_CONFIG.port), 10) || DEFAULT_CONFIG.port,
    ssl: raw["routeros.ssl"] === "true",
    user: raw["routeros.user"] ?? DEFAULT_CONFIG.user,
    password: raw["routeros.password"] ?? "",
  };
}

export function configToEntries(cfg: RouterOSConfig): Record<string, string> {
  return {
    "routeros.enabled": String(cfg.enabled),
    "routeros.host": cfg.host,
    "routeros.port": String(cfg.port),
    "routeros.ssl": String(cfg.ssl),
    "routeros.user": cfg.user,
    "routeros.password": cfg.password,
  };
}

function createConnection(cfg: RouterOSConfig): RouterOSAPI {
  return new RouterOSAPI({
    host: cfg.host,
    user: cfg.user,
    password: cfg.password,
    port: cfg.port,
    timeout: 6,
    tls: cfg.ssl ? { rejectUnauthorized: false } : undefined,
  });
}

export async function testConnection(cfg: RouterOSConfig): Promise<{ success: boolean; message: string; profiles: string[] }> {
  const conn = createConnection(cfg);
  try {
    await conn.connect();
    const rows: any[] = await conn.write("/ip/hotspot/profile/print");
    const profiles = rows.map((r) => r.name ?? "").filter(Boolean);
    return {
      success: true,
      message: `Connecté à ${cfg.host} — ${profiles.length} profil(s) hotspot trouvé(s)`,
      profiles,
    };
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    if (msg.includes("ECONNREFUSED") || msg.includes("ETIMEDOUT") || msg.includes("EHOSTUNREACH")) {
      return { success: false, message: `Connexion impossible à ${cfg.host}:${cfg.port} — vérifiez l'IP et le port API`, profiles: [] };
    }
    if (msg.toLowerCase().includes("cannot log in") || msg.toLowerCase().includes("bad credentials")) {
      return { success: false, message: "Authentification refusée — vérifiez le nom d'utilisateur et le mot de passe", profiles: [] };
    }
    return { success: false, message: `Erreur : ${msg}`, profiles: [] };
  } finally {
    try { await conn.close(); } catch { /* ignore */ }
  }
}

export async function createHotspotUser(
  cfg: RouterOSConfig,
  user: { name: string; password: string; profile: string }
): Promise<{ success: boolean; id?: string; error?: string }> {
  const conn = createConnection(cfg);
  try {
    await conn.connect();
    const result: any[] = await conn.write("/ip/hotspot/user/add", [
      `=name=${user.name}`,
      `=password=${user.password}`,
      `=profile=${user.profile}`,
    ]);
    const id = result[0]?.ret ?? result[0]?.[".id"];
    return { success: true, id };
  } catch (err: any) {
    return { success: false, error: err?.message ?? String(err) };
  } finally {
    try { await conn.close(); } catch { /* ignore */ }
  }
}
