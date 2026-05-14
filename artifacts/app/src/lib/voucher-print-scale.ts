/** Échelle d’impression des tickets (%, style dialogue d’impression du navigateur). Persistance locale, prise en compte immédiate. */

export const VOUCHER_PRINT_SCALE_DESKTOP_KEY = "vouchernet_voucher_print_scale_desktop_v1";
export const VOUCHER_PRINT_SCALE_MOBILE_KEY = "vouchernet_voucher_print_scale_mobile_v1";

export const VOUCHER_PRINT_SCALE_DEFAULT = 100;
export const VOUCHER_PRINT_SCALE_MIN = 0;
export const VOUCHER_PRINT_SCALE_MAX = 100;

export function clampVoucherPrintScale(n: number): number {
  if (!Number.isFinite(n)) return VOUCHER_PRINT_SCALE_DEFAULT;
  return Math.max(VOUCHER_PRINT_SCALE_MIN, Math.min(VOUCHER_PRINT_SCALE_MAX, Math.round(n)));
}

function readKey(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return clampVoucherPrintScale(parseInt(raw, 10));
  } catch {
    return fallback;
  }
}

function writeKey(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(clampVoucherPrintScale(value)));
  } catch {
    /* ignore */
  }
}

export function getVoucherPrintScaleDesktop(): number {
  if (typeof window === "undefined") return VOUCHER_PRINT_SCALE_DEFAULT;
  return readKey(VOUCHER_PRINT_SCALE_DESKTOP_KEY, VOUCHER_PRINT_SCALE_DEFAULT);
}

export function getVoucherPrintScaleMobile(): number {
  if (typeof window === "undefined") return VOUCHER_PRINT_SCALE_DEFAULT;
  return readKey(VOUCHER_PRINT_SCALE_MOBILE_KEY, VOUCHER_PRINT_SCALE_DEFAULT);
}

export function setVoucherPrintScaleDesktop(value: number): void {
  if (typeof window === "undefined") return;
  writeKey(VOUCHER_PRINT_SCALE_DESKTOP_KEY, value);
}

export function setVoucherPrintScaleMobile(value: number): void {
  if (typeof window === "undefined") return;
  writeKey(VOUCHER_PRINT_SCALE_MOBILE_KEY, value);
}
