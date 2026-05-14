const DESKTOP_KEY = "vouchernet_voucher_print_scale_desktop_v1";
const MOBILE_KEY = "vouchernet_voucher_print_scale_mobile_v1";

/** Facteurs proposés (liste déroulante) — impression vouchers navigateur. */
export const VOUCHER_PRINT_SCALE_CHOICES = [0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1] as const;

export type VoucherPrintScaleChoice = (typeof VOUCHER_PRINT_SCALE_CHOICES)[number];

function snapToChoice(n: number): VoucherPrintScaleChoice {
  let best = VOUCHER_PRINT_SCALE_CHOICES[0];
  let bestD = Math.abs(best - n);
  for (const v of VOUCHER_PRINT_SCALE_CHOICES) {
    const d = Math.abs(v - n);
    if (d < bestD) {
      best = v;
      bestD = d;
    }
  }
  return best;
}

function readStored(key: string): VoucherPrintScaleChoice {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null || raw === "") return 1;
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n)) return 1;
    return snapToChoice(n);
  } catch {
    return 1;
  }
}

export function getVoucherPrintScaleDesktop(): VoucherPrintScaleChoice {
  return readStored(DESKTOP_KEY);
}

export function getVoucherPrintScaleMobile(): VoucherPrintScaleChoice {
  return readStored(MOBILE_KEY);
}

export function setVoucherPrintScaleDesktop(scale: VoucherPrintScaleChoice): void {
  try {
    localStorage.setItem(DESKTOP_KEY, String(scale));
  } catch {
    /* ignore */
  }
}

export function setVoucherPrintScaleMobile(scale: VoucherPrintScaleChoice): void {
  try {
    localStorage.setItem(MOBILE_KEY, String(scale));
  } catch {
    /* ignore */
  }
}

export function formatVoucherPrintScaleLabel(scale: number): string {
  return `${Math.round(scale * 100)} %`;
}
