/**
 * URL de page de login hotspot (`http://<hôte>/login?username=…&password=…`).
 * `loginHost` doit être l’hôte API du routeur (IP ou DNS joignable), pas le libellé Contact.
 */
export function buildHotspotLoginUrl(
  loginHost: string,
  username: string,
  password: string,
): string | null {
  let host = (loginHost ?? "").trim();
  if (!host) return null;
  host = host.replace(/^https?:\/\//i, "");
  return `http://${host}/login?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
}
