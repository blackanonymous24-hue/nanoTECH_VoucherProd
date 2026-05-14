/**
 * Utilitaires alignés sur Mikhmon v3 pour les vouchers « small ».
 * Le HTML du ticket vient du fichier `ticket-templates/mikhmon-small.php.txt`
 * (template-small.php), rendu par `voucher-ticket-render.ts`.
 */

const UNITS = ["Byte", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"] as const;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Équivalent PHP `formatBytes($size, 2)` (divisions par 1024, libellés KiB/MiB…). */
export function formatMikhmonBytes(raw: string | number | null | undefined): string {
  let size = typeof raw === "number" ? raw : parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(size) || size <= 0) return "";
  let i = 0;
  for (; size >= 1024 && i < UNITS.length - 1; i++) {
    size /= 1024;
  }
  return `${size.toFixed(2)} ${UNITS[i]}`;
}

export function mikhmonProfilePriceLabel(p?: { price?: string | null; sellingPrice?: string | null } | null): string {
  if (!p) return "";
  const sp = String(p.sellingPrice ?? "").trim();
  const pr = String(p.price ?? "").trim();
  const isZero = (s: string) => {
    const n = parseFloat(s.replace(",", "."));
    return s === "" || (Number.isFinite(n) && n === 0);
  };
  if (sp && !isZero(sp)) return sp;
  if (pr && !isZero(pr)) return pr;
  return "";
}

/**
 * Même règle que Mikhmon `print.php` : préfixe du commentaire / id (`vc-…`, `up-…`),
 * sinon username === password → vc.
 */
export function inferMikhmonUserMode(
  comment: string | null | undefined,
  username: string,
  password: string,
): "vc" | "up" {
  const first = (comment ?? "").split("-")[0]?.toLowerCase() ?? "";
  if (first === "vc") return "vc";
  if (first === "up") return "up";
  return username === password ? "vc" : "up";
}
