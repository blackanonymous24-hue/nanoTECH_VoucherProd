const DESKTOP_KEY = "vouchernet_voucher_print_scale_desktop_v1";
const MOBILE_KEY = "vouchernet_voucher_print_scale_mobile_v1";

export const VOUCHER_PRINT_SCALE_MIN = 50;
export const VOUCHER_PRINT_SCALE_MAX = 150;
export const VOUCHER_PRINT_SCALE_DEFAULT = 100;

function clamp(n: number): number {
  return Math.min(VOUCHER_PRINT_SCALE_MAX, Math.max(VOUCHER_PRINT_SCALE_MIN, Math.round(n)));
}

function readStored(key: string): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null || raw === "") return VOUCHER_PRINT_SCALE_DEFAULT;
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n)) return VOUCHER_PRINT_SCALE_DEFAULT;
    const pct = n < 10 ? Math.round(n * 100) : Math.round(n);
    return clamp(pct);
  } catch {
    return VOUCHER_PRINT_SCALE_DEFAULT;
  }
}

function writeStored(key: string, pct: number): void {
  try {
    localStorage.setItem(key, String(clamp(pct)));
  } catch {
    /* ignore */
  }
}

export function getVoucherPrintScaleDesktop(): number {
  return readStored(DESKTOP_KEY);
}

export function getVoucherPrintScaleMobile(): number {
  return readStored(MOBILE_KEY);
}

export function setVoucherPrintScaleDesktop(pct: number): void {
  writeStored(DESKTOP_KEY, pct);
}

export function setVoucherPrintScaleMobile(pct: number): void {
  writeStored(MOBILE_KEY, pct);
}

export function formatVoucherPrintScaleLabel(pct: number): string {
  return `${Math.round(pct)} %`;
}

export function scaleFactorFromPct(pct: number): number {
  return clamp(pct) / 100;
}
