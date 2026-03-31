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
  port: 80,
  ssl: false,
  user: "admin",
  password: "",
};

export function parseConfig(raw: Record<string, string | null | undefined>): RouterOSConfig {
  return {
    enabled: raw["routeros.enabled"] === "true",
    host: raw["routeros.host"] ?? DEFAULT_CONFIG.host,
    port: parseInt(raw["routeros.port"] ?? String(DEFAULT_CONFIG.port), 10),
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

function baseUrl(cfg: RouterOSConfig) {
  const scheme = cfg.ssl ? "https" : "http";
  return `${scheme}://${cfg.host}:${cfg.port}/rest`;
}

function authHeader(cfg: RouterOSConfig) {
  return "Basic " + Buffer.from(`${cfg.user}:${cfg.password}`).toString("base64");
}

export async function testConnection(cfg: RouterOSConfig): Promise<{ success: boolean; message: string; profiles: string[] }> {
  try {
    const url = `${baseUrl(cfg)}/ip/hotspot/profile`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: authHeader(cfg), "Content-Type": "application/json" },
      signal: AbortSignal.timeout(6000),
    });

    if (res.status === 401) return { success: false, message: "Authentification refusée (mauvais identifiant/mot de passe)", profiles: [] };
    if (!res.ok) return { success: false, message: `Erreur RouterOS ${res.status}`, profiles: [] };

    const data: any[] = await res.json();
    const profiles = data.map((p) => p.name ?? "").filter(Boolean);
    return { success: true, message: `Connecté — ${profiles.length} profil(s) hotspot trouvé(s)`, profiles };
  } catch (err: any) {
    if (err.name === "TimeoutError" || err.code === "ECONNREFUSED") {
      return { success: false, message: "Connexion impossible — vérifiez l'IP et le port du routeur", profiles: [] };
    }
    return { success: false, message: `Erreur : ${err.message}`, profiles: [] };
  }
}

export async function createHotspotUser(
  cfg: RouterOSConfig,
  user: { name: string; password: string; profile: string }
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const url = `${baseUrl(cfg)}/ip/hotspot/user`;
    const res = await fetch(url, {
      method: "PUT",
      headers: { Authorization: authHeader(cfg), "Content-Type": "application/json" },
      body: JSON.stringify({ name: user.name, password: user.password, profile: user.profile }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { success: false, error: `${res.status}: ${text}` };
    }

    const data = await res.json();
    return { success: true, id: data[".id"] };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
