/**
 * Normalise l'hôte API MikroTik (supprime http(s)://, chemins accidentels, crochets IPv6).
 * Sans ça, un collage du type `https://192.168.88.1` fait échouer socket.connect().
 */
export function normalizeRouterApiHost(raw: string): string {
  const s = raw.trim();
  if (!s) return s;
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `http://${s}`;
    const u = new URL(withScheme);
    return u.hostname.replace(/^\[|\]$/g, "");
  } catch {
    return s
      .replace(/^https?:\/\//i, "")
      .split("/")[0]
      ?.trim() ?? s;
  }
}
