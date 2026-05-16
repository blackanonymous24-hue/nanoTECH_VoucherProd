/**
 * Format d’expiration dans le commentaire hotspot MikHmon / RouterOS.
 * Même règle que les scripts générés côté serveur ({@link isRouterOsBefore710} dans mikrotik.ts) :
 * - RouterOS **strictement avant 7.10** : `jan/15/2026 14:30:00` (mois abrégé anglais)
 * - RouterOS **7.10+** : `2026-01-15 14:30:00` (ISO)
 *
 * Si le commentaire existant contient déjà l’un des deux formats, on le conserve
 * pour rester cohérent avec le routeur ; sinon on se base sur la version RouterOS.
 */

const MK_MONTHS_OUT = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;

/** Aligné sur `isRouterOsBefore710` côté API (mikrotik.ts). */
export function isRouterOsLegacyHotspotExpiryComment(version: string | null | undefined): boolean {
  if (!version) return false;
  const m = String(version).match(/(\d+)\.(\d+)/);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
  return major < 7 || (major === 7 && minor <= 9);
}

export function formatMikrotikStyleExpiryComment(d: Date): string {
  const mon = MK_MONTHS_OUT[d.getMonth()];
  const day = String(d.getDate()).padStart(2, "0");
  const yr = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${mon}/${day}/${yr} ${hh}:${mm}:${ss}`;
}

export function formatIsoExpiryComment(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${mo}-${day} ${hh}:${mm}:${ss}`;
}

function pickExpiryCommentFormat(
  existingComment: string | null | undefined,
  routerOsVersion: string | null | undefined,
): "legacy" | "iso" {
  const c = (existingComment ?? "").trim();
  const hasIso = /(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}(?::\d{2})?)/.test(c);
  const hasLegacy = /([a-z]{3})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}:\d{2}(?::\d{2})?)/i.test(c);
  if (hasIso && !hasLegacy) return "iso";
  if (hasLegacy && !hasIso) return "legacy";
  return isRouterOsLegacyHotspotExpiryComment(routerOsVersion) ? "legacy" : "iso";
}

export function formatHotspotExpiryCommentForRouter(
  d: Date,
  existingComment: string | null | undefined,
  routerOsVersion: string | null | undefined,
): string {
  return pickExpiryCommentFormat(existingComment, routerOsVersion) === "legacy"
    ? formatMikrotikStyleExpiryComment(d)
    : formatIsoExpiryComment(d);
}
