/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CONTRAT PRODUIT — variables PHP des tickets VoucherNet (NE PAS ALTÉRER la
 * signification sans décision produit explicite. Toute couche client/serveur
 * qui remplit les substitutions doit rester strictement alignée.)
 *
 * - `$hotspotname` → nom du réseau Wi‑Fi (SSID / nom hotspot affiché au client).
 * - `$dnsname`     → texte « contact » du routeur (champ `contact` en base),
 *                    **pas** l’hôte IP ni l’URL d’API MikroTik.
 * - `$price`       → **devise** (ex. FCFA), **pas** le libellé tarifaire / montant
 *                    du forfait (celui-ci reste disponible via d’autres clés du
 *                    gabarit, ex. `$getprice`, selon le modèle nanoTECH / Mikhmon).
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** @see VOUCHER_TICKET_PHP_HOTSPOTNAME — nom Wi‑Fi affiché */
export function voucherTemplateWifiDisplayName(hotspotName: string, routerNameFallback: string): string {
  const h = (hotspotName ?? "").trim();
  if (h) return h;
  const f = (routerNameFallback ?? "").trim();
  return f || "Hotspot";
}

/** @see VOUCHER_TICKET_PHP_DNSNAME — contact routeur */
export function voucherTemplateDnsnameFromContact(
  routerContact: string | null | undefined,
  displayIfContactEmpty: string,
): string {
  const c = (routerContact ?? "").trim();
  if (c) return c;
  return (displayIfContactEmpty ?? "").trim();
}

/** @see VOUCHER_TICKET_PHP_PRICE — devise (code monétaire) */
export function voucherTemplatePricePhpVarValue(currencyCode: string): string {
  const x = (currencyCode ?? "").trim();
  return x || "FCFA";
}
