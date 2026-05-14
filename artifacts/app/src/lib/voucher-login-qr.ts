import QRCode from "qrcode";
import { buildHotspotLoginUrl } from "@/lib/voucher-login-qr-url";

export type BuildHotspotLoginQrOptions = {
  pixelWidth?: number;
  usermode?: "vc" | "up";
  errorCorrectionLevel?: "L" | "M" | "Q" | "H";
};

/**
 * Même rendu que `voucher-qr-server.ts` (PNG 64, marge 1, ECC L) — repli si l’API QR timeout (504).
 */
export async function buildHotspotLoginQrImgAttrs(
  loginHost: string,
  username: string,
  password: string,
  options?: BuildHotspotLoginQrOptions,
): Promise<string> {
  const usermode = options?.usermode ?? "up";
  let qrPayload: string;
  if (usermode === "vc") {
    qrPayload = (username ?? "").trim() || " ";
  } else {
    const loginUrl = buildHotspotLoginUrl(loginHost, username, password);
    if (!loginUrl) return 'src="" alt=""';
    qrPayload = loginUrl;
  }
  const w = options?.pixelWidth ?? 64;
  const ecc = options?.errorCorrectionLevel ?? "L";
  try {
    const dataUrl = await QRCode.toDataURL(qrPayload, {
      width: w,
      margin: 1,
      errorCorrectionLevel: ecc,
      type: "image/png",
      color: { dark: "#000000", light: "#ffffff" },
    });
    return `src="${dataUrl}" alt=""`;
  } catch {
    return 'src="" alt=""';
  }
}
