/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CONTRAT PRODUIT — variables PHP des tickets VoucherNet (NE PAS ALTÉRER la
 * signification sans décision produit explicite). Toute couche client/serveur
 * qui remplit les substitutions doit rester strictement alignée.
 *
 * MIROIR de `artifacts/app/src/lib/voucher-ticket-template-semantics.ts` : toute
 * modification doit être dupliquée dans l’autre fichier.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export const VOUCHER_TICKET_PHP_VAR_CONTRACT = {
  hotspotname: {
    phpVar: "$hotspotname",
    label: "Nom du Wi‑Fi",
    routerField: "Nom hotspot du routeur (sinon nom du routeur)",
  },
  price: {
    phpVar: "$price",
    label: "Tarif forfait",
    routerField: "Prix de vente / price du profil hotspot (sellingPrice ou price)",
  },
  currency: {
    phpVar: "$currency",
    label: "Devise",
    routerField: "Devise du routeur (ex. FCFA)",
  },
  dnsname: {
    phpVar: "$dnsname",
    label: "Contact",
    routerField: "Contact du routeur",
  },
} as const;

export type VoucherTicketPhpContractKey = keyof typeof VOUCHER_TICKET_PHP_VAR_CONTRACT;

export type VoucherTicketRouterFields = {
  hotspotName?: string | null;
  name?: string | null;
  currency?: string | null;
  contact?: string | null;
  host?: string | null;
};

export function voucherTemplateWifiDisplayName(
  hotspotName: string,
  routerNameFallback: string,
): string {
  const h = (hotspotName ?? "").trim();
  if (h) return h;
  const f = (routerNameFallback ?? "").trim();
  return f || "Hotspot";
}

export function voucherTemplateDnsnameFromContact(
  routerContact: string | null | undefined,
  displayIfContactEmpty: string,
): string {
  const c = (routerContact ?? "").trim();
  if (c) return c;
  return (displayIfContactEmpty ?? "").trim();
}

/** @see VOUCHER_TICKET_PHP_VAR_CONTRACT.currency */
export function voucherTemplateCurrencyPhpVarValue(currencyCode: string): string {
  const x = (currencyCode ?? "").trim();
  return x || "FCFA";
}

export function buildVoucherTicketPhpFieldsFromRouter(router: VoucherTicketRouterFields): {
  hotspotName: string;
  currency: string;
  dnsname: string;
  qrLoginHost: string;
} {
  const hotspotName = voucherTemplateWifiDisplayName(
    router.hotspotName ?? "",
    router.name ?? "",
  );
  const currency = voucherTemplateCurrencyPhpVarValue(router.currency ?? "");
  const dnsname = voucherTemplateDnsnameFromContact(router.contact, hotspotName);
  const qrLoginHost = (router.host ?? "").trim() || hotspotName;
  return { hotspotName, currency, dnsname, qrLoginHost };
}
