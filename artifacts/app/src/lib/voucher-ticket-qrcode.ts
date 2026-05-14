/**
 * QR code des tickets : PNG intrinsèque 64×64 (correction L, léger).
 * `<?= $qrcode ?>` fournit `class="vn-voucher-qr"`, `src`, `alt`, `decoding` (pas de width/height).
 * La taille d’affichage est plafonnée par la feuille `MIKHMON_VOUCHER_PRINT_CSS` ; le gabarit peut rester plus petit.
 */

import QRCode from "qrcode";
import { buildHotspotLoginUrl } from "@/lib/voucher-login-qr-url";

const VOUCHER_QR_PNG_OPTS = {
  type: "image/png" as const,
  width: 64,
  margin: 1,
  errorCorrectionLevel: "L" as const,
};

/** Fragment HTML pour `<img … <?= $qrcode ?>>` (classe + src + décodage async). */
export async function buildVoucherQrImgAttrs(
  loginHost: string,
  username: string,
  password: string,
): Promise<string> {
  const loginUrl = buildHotspotLoginUrl(loginHost, username, password);
  if (!loginUrl) return 'class="vn-voucher-qr" src="" alt=""';
  try {
    const dataUrl = await QRCode.toDataURL(loginUrl, VOUCHER_QR_PNG_OPTS);
    return `class="vn-voucher-qr" src="${dataUrl}" alt="" decoding="async"`;
  } catch {
    return 'class="vn-voucher-qr" src="" alt=""';
  }
}

/** Génère tous les QR en parallèle (impression plus fluide sur les lots). */
export async function buildVoucherQrImgAttrsBatch(
  loginHost: string,
  users: { username: string; password: string }[],
): Promise<string[]> {
  const host = loginHost.trim();
  if (!host) return users.map(() => 'class="vn-voucher-qr" src="" alt=""');
  return Promise.all(users.map((u) => buildVoucherQrImgAttrs(host, u.username, u.password)));
}
