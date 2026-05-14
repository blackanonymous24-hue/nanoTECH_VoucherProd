/**
 * URL de connexion hotspot MikroTik (captive portal) pour encodage en QR.
 * `loginHost` : hôte ou URL de base (ex. `192.168.88.1`, `https://hotspot.example.com`).
 */
export function buildHotspotLoginUrl(loginHost: string, username: string, password: string): string | null {
  const host = loginHost.trim();
  if (!host || !String(username ?? "").length) return null;
  try {
    const origin = /^https?:\/\//i.test(host) ? host : `http://${host}`;
    const base = new URL(origin.endsWith("/") ? origin : `${origin}/`);
    const login = new URL("login", base);
    login.searchParams.set("username", username);
    login.searchParams.set("password", password);
    return login.href;
  } catch {
    return null;
  }
}
