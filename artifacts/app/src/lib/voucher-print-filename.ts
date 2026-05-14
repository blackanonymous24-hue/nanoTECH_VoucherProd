/**
 * Nom de document PDF / impression vouchers :
 * `Voucher-{HOTSPOT}-{PROFIL}-{commentaire-lot}`
 * Ex. : Voucher-WIFI-ABONNEMENT-vc-802-05.09.26-1JHOME
 */

function stripCombiningMarks(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Hotspot / profil : majuscules, sans espaces, caractères sûrs (A-Z 0-9 . _ -). */
export function voucherPrintTitleSegment(s: string): string {
  const t = stripCombiningMarks(s)
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9._-]/g, "");
  return t || "X";
}

/** Commentaire de lot : casse conservée ; caractères interdits Windows → '-'. */
export function voucherPrintLotSegment(lot: string): string {
  const t = stripCombiningMarks(lot)
    .trim()
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-");
  return t || "lot";
}

export function buildVoucherPdfDocumentTitle(
  hotspotName: string,
  profileName: string,
  lotCommentOrName: string,
): string {
  return `Voucher-${voucherPrintTitleSegment(hotspotName)}-${voucherPrintTitleSegment(profileName)}-${voucherPrintLotSegment(lotCommentOrName)}`;
}
