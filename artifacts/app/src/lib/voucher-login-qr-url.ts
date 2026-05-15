/**
 * Construit l'URL de connexion automatique au portail hotspot MikroTik.
 * Format : http://<host>/login?username=<user>&password=<pass>
 *
 * Retourne `null` si le host est absent (QR non généré).
 */
export function buildHotspotLoginUrl(
  loginHost: string,
  username: string,
  password: string,
): string | null {
  const host = loginHost.trim();
  if (!host) return null;

  const base = host.startsWith("http://") || host.startsWith("https://")
    ? host.replace(/\/$/, "")
    : `http://${host}`;

  const params = new URLSearchParams({ username, password });
  return `${base}/login?${params.toString()}`;
}
