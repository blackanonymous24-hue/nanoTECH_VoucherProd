/**
 * Corrige les LITTÉRAUX mojibakés dans les fichiers source du repo.
 *
 * Un littéral mojibaké = une séquence dont les caractères correspondent à des
 * octets UTF-8 (de "é" = C3 A9) lus comme du Latin-1 ("Ã©"). Le fichier source
 * lui-même est en UTF-8 valide, mais le contenu des chaînes affichées par
 * l'UI sortira tel quel à l'écran.
 *
 * Stratégie :
 *   1. Lire chaque fichier en UTF-8
 *   2. Pour chaque chunk de texte contenant l'un des marqueurs Ã, Â, â,
 *      essayer de le "désencoder" en interprétant ses chars comme des octets,
 *      puis re-décoder en UTF-8 strict. Si ça donne quelque chose de plausible
 *      (toujours valide UTF-8 ET ne contient plus les marqueurs ET contient
 *      au moins un caractère accentué attendu), on remplace.
 *   3. Idempotent : ré-exécution = noop.
 *
 * Usage :
 *   node deploy/fix-source-mojibake.mjs           # dry-run
 *   node deploy/fix-source-mojibake.mjs --apply   # modifie en place
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const APPLY = process.argv.includes("--apply");

const exts = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".html", ".json", ".md", ".sql"]);
const files = execSync("git ls-files", { encoding: "utf-8" })
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((f) => {
    if (f.startsWith("artifacts/app/dist/") || f.startsWith("artifacts/api-server/dist/")) return false;
    if (f.startsWith("node_modules/")) return false;
    const idx = f.lastIndexOf(".");
    return idx >= 0 && exts.has(f.slice(idx).toLowerCase());
  });

// Regex mojibake : un marqueur (Ã / Â / â) suivi de 1+ chars typiques d'UTF-8-lu-en-latin1.
// On accepte les chars en 0x80-0xFF (Latin-1 supplément, bytes UTF-8 continuation)
// et 0x2000-0x2BFF (punctuation typographique Win1252 mappée en Unicode).
const MOJI = /[ÃÂâ][\u0080-\u00FF\u2000-\u2BFF]+/g;

const utf8Strict = new TextDecoder("utf-8", { fatal: true });

/** Tente de "désencoder" un segment mojibaké en re-interprétant ses chars comme octets latin1 puis UTF-8. */
function tryFix(seg) {
  if (!seg) return null;
  // Convertit chaque char en son code point bas-8-bits (≤0xFF). Si un char
  // dépasse, on échoue (mojibake doit rester dans [0x00..0xFF]).
  const bytes = new Uint8Array(seg.length);
  for (let i = 0; i < seg.length; i++) {
    const c = seg.charCodeAt(i);
    if (c > 0xFF) {
      // ex. "â€™" : "â"=0xE2 "€"=0x20AC "™"=0x2122. Reverse map des PUA Win1252.
      const reverseWin1252 = {
        0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85,
        0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A,
        0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92,
        0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
        0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C,
        0x017E: 0x9E, 0x0178: 0x9F,
      };
      const b = reverseWin1252[c];
      if (b === undefined) return null;
      bytes[i] = b;
    } else {
      bytes[i] = c;
    }
  }
  let decoded;
  try {
    decoded = utf8Strict.decode(bytes);
  } catch {
    return null;
  }
  // refuse si le résultat contient toujours du Ã / Â / â typiques de mojibake
  if (/[ÃÂâ][\u0080-\u00FF]/.test(decoded) && !/[éèêëàâäîïôöùûüÿç]/i.test(decoded)) {
    return null;
  }
  return decoded;
}

let scanned = 0;
let touched = 0;
const samples = [];

for (const file of files) {
  scanned++;
  let text;
  try {
    text = readFileSync(file, "utf-8");
  } catch {
    continue;
  }
  if (!MOJI.test(text)) continue;
  // reset lastIndex
  MOJI.lastIndex = 0;

  const fixed = text.replace(MOJI, (seg) => {
    const out = tryFix(seg);
    if (out == null) return seg;
    return out;
  });

  if (fixed === text) continue;

  // Trouve un échantillon avant/après pour log
  const beforeIdx = text.search(MOJI);
  const sample = {
    file,
    before: text.slice(Math.max(0, beforeIdx - 15), beforeIdx + 40).replace(/\n/g, "\\n"),
    after:  fixed.slice(Math.max(0, beforeIdx - 15), beforeIdx + 40).replace(/\n/g, "\\n"),
  };
  samples.push(sample);

  if (APPLY) writeFileSync(file, fixed, "utf-8");
  touched++;
}

for (const s of samples) {
  console.log(`\n${s.file}`);
  console.log(`  − ${s.before}`);
  console.log(`  + ${s.after}`);
}
console.log(`\nScanned: ${scanned}  Touched: ${touched}  Mode: ${APPLY ? "APPLIED" : "DRY-RUN"}`);
