/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CONTRAT PRODUIT — variables PHP des tickets VoucherNet (NE PAS ALTÉRER la
 * signification sans décision produit explicite). Toute couche client/serveur
 * qui remplit les substitutions doit rester strictement alignée.
 *
 * MIROIR : `artifacts/api-server/src/lib/voucher-ticket-template-semantics.ts`
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** Contrat ancré dans l’app — source unique pour libellés UI et substitution. */
export const VOUCHER_TICKET_PHP_VAR_CONTRACT = {
  hotspotname: {
    phpVar: "$hotspotname",
    label: "Nom du Wi‑Fi",
    routerField: "Nom hotspot du routeur (sinon nom du routeur)",
  },
  price: {
    phpVar: "$price",
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

export const VOUCHER_TICKET_PHP_VAR_CONTRACT_LIST: {
  key: VoucherTicketPhpContractKey;
  phpVar: string;
  label: string;
  routerField: string;
}[] = (Object.keys(VOUCHER_TICKET_PHP_VAR_CONTRACT) as VoucherTicketPhpContractKey[]).map(
  (key) => ({ key, ...VOUCHER_TICKET_PHP_VAR_CONTRACT[key] }),
);

export type VoucherTicketRouterFields = {
  hotspotName?: string | null;
  name?: string | null;
  currency?: string | null;
  contact?: string | null;
  host?: string | null;
};

/** @see VOUCHER_TICKET_PHP_VAR_CONTRACT.hotspotname */
export function voucherTemplateWifiDisplayName(
  hotspotName: string,
  routerNameFallback: string,
): string {
  const h = (hotspotName ?? "").trim();
  if (h) return h;
  const f = (routerNameFallback ?? "").trim();
  return f || "Hotspot";
}

/** @see VOUCHER_TICKET_PHP_VAR_CONTRACT.dnsname */
export function voucherTemplateDnsnameFromContact(
  routerContact: string | null | undefined,
  displayIfContactEmpty: string,
): string {
  const c = (routerContact ?? "").trim();
  if (c) return c;
  return (displayIfContactEmpty ?? "").trim();
}

/** @see VOUCHER_TICKET_PHP_VAR_CONTRACT.price */
export function voucherTemplatePricePhpVarValue(currencyCode: string): string {
  const x = (currencyCode ?? "").trim();
  return x || "FCFA";
}

/**
 * Résout les trois variables PHP contractuelles + l’hôte pour le QR login
 * (le QR utilise l’IP/hôte routeur, pas le contact affiché dans `$dnsname`).
 */
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
  const currency = voucherTemplatePricePhpVarValue(router.currency ?? "");
  const dnsname = voucherTemplateDnsnameFromContact(router.contact, hotspotName);
  const qrLoginHost = (router.host ?? "").trim() || hotspotName;
  return { hotspotName, currency, dnsname, qrLoginHost };
}
