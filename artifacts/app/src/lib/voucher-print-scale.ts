/**
 * Échelle d'impression vouchers — per-template (0–100).
 * Chaque templateId a sa propre valeur en localStorage et en base.
 */

const DEFAULT_PERCENT = 85;
const STORAGE_KEY_PREFIX   = "vouchernet_print_scale_v2_";
const CURRENT_TEMPLATE_KEY = "vouchernet_current_print_template_v1";

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_PERCENT;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/** Retourne l'échelle pour un templateId donné (défaut 85 %). */
export function getVoucherPrintScalePercent(templateId?: string): number {
  const id = templateId ?? getCurrentPrintTemplateId();
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + id);
    if (raw != null && raw !== "") return clampPercent(Number.parseFloat(raw));
    // Migration depuis l'ancienne clé globale (avant per-template).
    const legacy = localStorage.getItem("vouchernet_voucher_print_scale_pct_web_v1");
    if (legacy != null && legacy !== "") return clampPercent(Number.parseFloat(legacy));
  } catch {
    /* ignore */
  }
  return DEFAULT_PERCENT;
}

/** Sauvegarde l'échelle pour un templateId en localStorage. */
export function setVoucherPrintScalePercent(templateId: string, percent: number): void {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + templateId, String(clampPercent(percent)));
  } catch {
    /* ignore */
  }
}

/** Template actif pour l'impression (mis à jour quand l'utilisateur change de template). */
export function getCurrentPrintTemplateId(): string {
  try {
    return localStorage.getItem(CURRENT_TEMPLATE_KEY) ?? "nanotech-normal";
  } catch {
    return "nanotech-normal";
  }
}

/** À appeler quand le template actif change (TicketTemplate, SuperAdmins). */
export function setCurrentPrintTemplateId(id: string): void {
  try {
    localStorage.setItem(CURRENT_TEMPLATE_KEY, id);
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
