/**
 * QR code des tickets : PNG intrinsèque 64×64 (correction L, léger).
 * `<?= $qrcode ?>` fournit `src`, `alt`, `decoding` (pas de width/height) : la taille d’affichage vient du gabarit
 * (attributs ou style sur la balise `<img>` autour de `<?= $qrcode ?>`).
 */

import QRCode from "qrcode";
import { buildHotspotLoginUrl } from "@/lib/voucher-login-qr-url";

const VOUCHER_QR_PNG_OPTS = {
  type: "image/png" as const,
  width: 64,
  margin: 1,
  errorCorrectionLevel: "L" as const,
};

/** Fragment HTML pour `<img … <?= $qrcode ?>>` (src + décodage async). */
export async function buildVoucherQrImgAttrs(
  loginHost: string,
  username: string,
  password: string,
): Promise<string> {
  const loginUrl = buildHotspotLoginUrl(loginHost, username, password);
  if (!loginUrl) return 'src="" alt=""';
  try {
    const dataUrl = await QRCode.toDataURL(loginUrl, VOUCHER_QR_PNG_OPTS);
    return `src="${dataUrl}" alt="" decoding="async"`;
  } catch {
    return 'src="" alt=""';
  }
}

/** Génère tous les QR en parallèle (impression plus fluide sur les lots). */
export async function buildVoucherQrImgAttrsBatch(
  loginHost: string,
  users: { username: string; password: string }[],
): Promise<string[]> {
  const host = loginHost.trim();
  if (!host) return users.map(() => 'src="" alt=""');
  return Promise.all(users.map((u) => buildVoucherQrImgAttrs(host, u.username, u.password)));
}
