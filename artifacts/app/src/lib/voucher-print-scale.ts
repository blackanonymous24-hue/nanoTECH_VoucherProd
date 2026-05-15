/** Pourcentage 0–100 : même logique que la « Mise à l'échelle » du dialogue d'impression Chromium (Chrome / Edge). */
const LEGACY_STORAGE_KEY = "vouchernet_voucher_print_scale_pct_v1";
const STORAGE_KEY_WEB    = "vouchernet_voucher_print_scale_pct_web_v1";
const STORAGE_KEY_MOBILE = "vouchernet_voucher_print_scale_pct_mobile_v1";
const STORAGE_KEY_IOS    = "vouchernet_voucher_print_scale_pct_ios_v1";
const DEFAULT_PERCENT = 100;

export type VoucherPrintScaleProfile = "web" | "mobile" | "ios";

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_PERCENT;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function isNativeWebView(): boolean {
  return typeof window !== "undefined" && !!window.ReactNativeWebView;
}

function isIOSUserAgent(): boolean {
  if (typeof navigator === "undefined") return false;
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) return true;
  // iPadOS 13+ s'identifie comme Macintosh mais possède le multi-touch
  if (navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent)) return true;
  return false;
}

function isAndroidUserAgent(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent);
}

function isMobileUserAgent(): boolean {
  return isIOSUserAgent() || isAndroidUserAgent() ||
    (typeof navigator !== "undefined" &&
      /Mobi|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent));
}

/** Profil actif pour lecture / écriture (impression incluse). */
export function getActiveVoucherPrintScaleProfile(): VoucherPrintScaleProfile {
  if (typeof window === "undefined") return "web";
  if (!isNativeWebView() && !isMobileUserAgent()) return "web";
  if (isIOSUserAgent()) return "ios";
  return "mobile"; // Android + autres mobiles
}

function storageKey(profile: VoucherPrintScaleProfile): string {
  if (profile === "ios")    return STORAGE_KEY_IOS;
  if (profile === "mobile") return STORAGE_KEY_MOBILE;
  return STORAGE_KEY_WEB;
}

/**
 * Lecture pour un profil donné. L'ancienne clé unique est migrée vers le web uniquement.
 */
export function getVoucherPrintScalePercentFor(profile: VoucherPrintScaleProfile): number {
  try {
    const key = storageKey(profile);
    let raw = localStorage.getItem(key);
    if ((raw == null || raw === "") && profile === "web") {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy != null && legacy !== "") {
        raw = legacy;
        localStorage.setItem(key, legacy);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
    }
    if (raw == null || raw === "") return DEFAULT_PERCENT;
    return clampPercent(Number.parseFloat(raw));
  } catch {
    return DEFAULT_PERCENT;
  }
}

export function setVoucherPrintScalePercentFor(profile: VoucherPrintScaleProfile, percent: number): void {
  try {
    localStorage.setItem(storageKey(profile), String(clampPercent(percent)));
  } catch {
    /* ignore */
  }
}

/** Valeur utilisée à l'impression selon l'environnement courant (web / android / ios). */
export function getVoucherPrintScalePercent(): number {
  return getVoucherPrintScalePercentFor(getActiveVoucherPrintScaleProfile());
}

/** Sauvegarde pour le profil courant. */
export function setVoucherPrintScalePercent(percent: number): void {
  setVoucherPrintScalePercentFor(getActiveVoucherPrintScaleProfile(), percent);
}

/**
 * Facteur pour `html { zoom: … }` — préféré à `transform: scale()` en impression Chromium.
 * 100 % → 1 ; 0 % → 0,01 (évite un zoom nul).
 */
export function getVoucherPrintZoomFactorFromPercent(percent: number): number {
  const p = clampPercent(percent);
  if (p >= 100) return 1;
  if (p <= 0) return 0.01;
  return p / 100;
}
