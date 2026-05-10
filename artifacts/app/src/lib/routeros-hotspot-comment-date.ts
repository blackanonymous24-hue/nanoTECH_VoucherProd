/**
 * Dates d’expiration dans le champ « comment » des utilisateurs hotspot MikroTik.
 * RouterOS 6 / scripts Mikhmon classiques : `jan/15/2026 14:30:00`
 * RouterOS 7+ (souvent) : `2026-01-15 14:30:00`
 */

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const MK_MONTHS_OUT = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Format historique (RouterOS 6 / Mikhmon) : mmm/dd/yyyy HH:mm:ss */
export function formatLegacyMikrotikCommentDate(d: Date): string {
  const mon = MK_MONTHS_OUT[d.getMonth()];
  const day = String(d.getDate()).padStart(2, "0");
  const yr = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${mon}/${day}/${yr} ${hh}:${mm}:${ss}`;
}

/** Format ISO-style souvent produit par RouterOS 7+ dans les scripts / horloge */
export function formatIsoRouterOsCommentDate(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${mo}-${day} ${hh}:${mm}:${ss}`;
}

/** Extrait le major (ex. "7.16.2" → 7, "6.49.10" → 6). */
export function parseRouterOsMajor(version: string | null | undefined): number | null {
  if (!version) return null;
  const m = String(version).trim().match(/^(\d+)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Détecte le style de date déjà présent dans le commentaire (hors préfixes vc-/up-).
 */
export function detectExpirationFormatFromComment(comment: string | null | undefined): "legacy" | "iso" | null {
  if (!comment) return null;
  const c = comment.trim();
  if (!c) return null;
  if (/^(vc|up)[-_]/i.test(c)) return null;

  const mtkRe = /([a-z]{3})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/gi;
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = mtkRe.exec(c)) !== null) last = m;
  if (last && MONTHS[last[1].toLowerCase()] != null) return "legacy";

  const isoRe = /(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/;
  if (isoRe.test(c)) return "iso";

  return null;
}

/**
 * Choisit le format à écrire lors d’une prolongation :
 * 1) celui déjà présent dans le commentaire ;
 * 2) sinon RouterOS ≥ 7 → ISO, sinon format legacy.
 */
export function pickHotspotCommentDateFormat(
  comment: string | null | undefined,
  routerOsVersion: string | null | undefined,
): "legacy" | "iso" {
  const fromComment = detectExpirationFormatFromComment(comment);
  if (fromComment) return fromComment;
  const major = parseRouterOsMajor(routerOsVersion);
  if (major != null && major >= 7) return "iso";
  return "legacy";
}

export function formatHotspotCommentDateByFormat(d: Date, format: "legacy" | "iso"): string {
  return format === "iso" ? formatIsoRouterOsCommentDate(d) : formatLegacyMikrotikCommentDate(d);
}
