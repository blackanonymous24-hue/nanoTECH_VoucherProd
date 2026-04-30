/** Mois courts anglais, même style que les dates dans les commentaires hotspot (ex. may/30/2026 …). */
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;

/**
 * Format lisible type commentaire MikroTik / hotspot : `may/30/2026 01:16:49` (heure locale).
 */
export function formatVnetexpDate(d: Date): string {
  const m = MONTHS[d.getMonth()];
  const day = d.getDate();
  const y = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${m}/${day}/${y} ${hh}:${mm}:${ss}`;
}

/**
 * Interprète la charge utile date (sans les crochets).
 * - Ancien format ISO : `2026-05-30T01:16:49.055Z` (toujours accepté)
 * - Format commentaire : `may/30/2026 01:16:49`
 */
export function parseVnetexpToMs(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const fromIso = Date.parse(s);
  if (!Number.isNaN(fromIso)) return fromIso;

  const m1 = s.match(/^([a-z]{3})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/i);
  if (m1) {
    const monStr = m1[1].toLowerCase();
    const monthIdx = MONTHS.findIndex((x) => x === monStr);
    if (monthIdx < 0) return null;
    const day = Number(m1[2]);
    const year = Number(m1[3]);
    const hh = Number(m1[4]);
    const min = Number(m1[5]);
    const sec = m1[6] !== undefined ? Number(m1[6]) : 0;
    if (
      [day, year, hh, min, sec].some((n) => Number.isNaN(n)) ||
      day < 1 ||
      day > 31 ||
      hh > 23 ||
      min > 59 ||
      sec > 59
    ) {
      return null;
    }
    const d = new Date(year, monthIdx, day, hh, min, sec, 0);
    const t = d.getTime();
    return Number.isNaN(t) ? null : t;
  }

  return null;
}

/** Balise actuelle : `[Expire le:…]` ; ancienne : `[vnetexp:…]` (toujours lue). */
export function extractVnetexpPayload(comment: string): string | null {
  const mNew = comment.match(/\[Expire le:([^\]]+)\]/);
  if (mNew?.[1]?.trim()) return mNew[1].trim();
  const mLegacy = comment.match(/\[vnetexp:([^\]]+)\]/);
  const inner = mLegacy?.[1]?.trim();
  return inner || null;
}

export function parseVnetexpFromComment(comment: string | null | undefined): number | null {
  const p = extractVnetexpPayload(comment ?? "");
  if (!p) return null;
  return parseVnetexpToMs(p);
}

export function appendVnetexpTag(commentSansTags: string, end: Date): string {
  const t = commentSansTags.trim();
  const payload = formatVnetexpDate(end);
  return `${t} [Expire le:${payload}]`.trim();
}
