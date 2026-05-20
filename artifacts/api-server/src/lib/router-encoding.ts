/**
 * Encodage RouterOS ↔ UTF-8
 *
 * MikroTik / WinBox stockent les chaînes en Windows-1252 (1 octet par
 * caractère). node-routeros transporte ces octets bruts dans une chaîne JS
 * où chaque caractère a la valeur d'un seul octet (≤ 0xFF). Selon l'origine
 * (terminal SSH UTF-8, WinBox Win1252, copie depuis un autre routeur), on
 * peut recevoir deux formes de "mojibake" pour le même mot "Koné" :
 *
 *   1. UTF-8 brut interprété en latin1 → "KonÃ©" (5 chars, octets C3 A9)
 *   2. Win1252 natif                   → "Koné" (4 chars, octet E9 directement)
 *
 * `decodeRouterText` est IDEMPOTENT : appliqué sur une chaîne déjà correcte
 * (UTF-8 ou ASCII), il la renvoie intacte. On peut donc l'appliquer en
 * défense profonde à la lecture ET aux sorties API sans risque.
 */
import iconv from "iconv-lite";

/**
 * Convertit une chaîne UTF-8 en sa séquence d'octets Windows-1252, puis en
 * une chaîne JS où chaque caractère vaut un octet (≤ 0xFF). C'est ce que
 * node-routeros pousse sur le fil, donc à utiliser AVANT api.write() pour
 * tout argument qui contient des accents.
 */
export function toWin1252(str: string): string {
  try {
    const buf = iconv.encode(str, "win1252");
    return Array.from(buf as Uint8Array).map((b) => String.fromCharCode(b)).join("");
  } catch {
    return str;
  }
}

/**
 * Réciproque de `toWin1252` : on reçoit une chaîne dont les caractères sont
 * des octets bruts (≤ 0xFF). Si ces octets forment une séquence UTF-8 valide,
 * on renvoie la chaîne UTF-8 décodée. Sinon, on tente Win1252 (cas legacy).
 * Pure ASCII : passe sans changement.
 */
export function fromWin1252(str: string): string {
  if (!str) return str;
  let needsDecode = false;
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) > 0x7F) { needsDecode = true; break; }
  }
  if (!needsDecode) return str;
  try {
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      const buf = Buffer.from(Array.from(str, (c) => c.charCodeAt(0) & 0xff));
      return iconv.decode(buf, "win1252");
    } catch {
      return str;
    }
  }
}

const WIN1252_REVERSE: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
};

/**
 * Convertit un mojibake Win1252 transformé en codepoints Unicode (ex. l'apostrophe
 * intelligente U+2019 ré-encodée en 0x92) vers ses octets équivalents.
 * Utilisé en pré-traitement de `decodeRouterText`.
 */
export function fixEncoding(str: string): string {
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

/**
 * Normalisation IDEMPOTENTE pour les textes provenant de RouterOS (ou stockés
 * en DB et potentiellement mojibakés). À utiliser au moment du rendu API.
 *
 *   decodeRouterText(undefined)      → ""
 *   decodeRouterText("Famille KonÃ©") → "Famille Koné"
 *   decodeRouterText("Famille Koné")  → "Famille Koné"  (no-op)
 *   decodeRouterText("Pierre")        → "Pierre"        (no-op)
 */
export function decodeRouterText(str: string | null | undefined): string {
  if (!str) return "";
  return fromWin1252(fixEncoding(str));
}

/** Variante qui préserve null (pour les colonnes nullables comme `comment`). */
export function decodeRouterTextNullable(str: string | null | undefined): string | null {
  if (str == null) return null;
  const decoded = decodeRouterText(str);
  return decoded;
}
