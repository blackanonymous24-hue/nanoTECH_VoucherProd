/**
 * Échelle d'impression vouchers (0–100).
 * Une seule valeur globale, définie par le super admin et diffusée à tous les comptes.
 */
const LEGACY_STORAGE_KEY = "vouchernet_voucher_print_scale_pct_v1";
const STORAGE_KEY_WEB    = "vouchernet_voucher_print_scale_pct_web_v1";
const DEFAULT_PERCENT    = 85;

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_PERCENT;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/** Lecture de l'échelle courante (avec migration de l'ancienne clé). */
export function getVoucherPrintScalePercent(): number {
  try {
    let raw = localStorage.getItem(STORAGE_KEY_WEB);
    if (raw == null || raw === "") {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy != null && legacy !== "") {
        raw = legacy;
        localStorage.setItem(STORAGE_KEY_WEB, legacy);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
    }
    if (raw == null || raw === "") return DEFAULT_PERCENT;
    return clampPercent(Number.parseFloat(raw));
  } catch {
    return DEFAULT_PERCENT;
  }
}

/** Sauvegarde de l'échelle en localStorage. */
export function setVoucherPrintScalePercent(percent: number): void {
  try {
    localStorage.setItem(STORAGE_KEY_WEB, String(clampPercent(percent)));
  } catch {
    /* ignore */
  }
}

/**
 * Facteur pour `html { zoom: … }`.
 * 100 % → 1 ; 0 % → 0.01 (évite un zoom nul).
 */
export function getVoucherPrintZoomFactorFromPercent(percent: number): number {
  const p = clampPercent(percent);
  if (p >= 100) return 1;
  if (p <= 0) return 0.01;
  return p / 100;
}
