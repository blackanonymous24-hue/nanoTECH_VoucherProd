/**
 * Détection des variables PHP affichées dans un modèle de ticket (aligné sur
 * `substituteTicketVars` dans `voucher-ticket-render.ts`).
 */

/** Libellés FR pour les clés connues (même sémantique que les champs d’impression). */
export const TICKET_TEMPLATE_VAR_LABELS: Record<string, string> = {
  hotspotname: "Nom du Wi‑Fi",
  num: "Numéro du ticket",
  username: "Identifiant",
  password: "Mot de passe",
  validity: "Validité",
  timelimit: "Durée / limite",
  datalimit: "Quota données",
  price: "Ligne prix (forfait)",
  getprice: "Montant clé (palette couleur)",
  currency: "Devise",
  dnsname: "Contact",
  color: "Couleur d’accent",
  qrcode: "QR code",
};

const CANONICAL_ORDER = [
  "hotspotname",
  "num",
  "username",
  "password",
  "validity",
  "timelimit",
  "datalimit",
  "price",
  "getprice",
  "currency",
  "dnsname",
  "color",
  "qrcode",
] as const;

/**
 * Retourne les noms de variables réellement « écho » dans le modèle (hors blocs PHP logiques type if).
 */
export function extractTicketTemplateVariableKeys(source: string): string[] {
  const found = new Set<string>();
  const add = (k: string) => {
    const n = k.toLowerCase();
    if (n && /^[a-z_][a-z0-9_]*$/i.test(n)) found.add(n);
  };

  const phpEcho = /<\?php\s+echo\s+\$([a-zA-Z_][a-zA-Z0-9_]*)\s*;?\s*\?>/gi;
  let m: RegExpExecArray | null;
  while ((m = phpEcho.exec(source)) !== null) add(m[1]);

  const shortEcho = /<\?=\s*\$([a-zA-Z_][a-zA-Z0-9_]*)\s*;?\s*\?>/gi;
  while ((m = shortEcho.exec(source)) !== null) add(m[1]);

  if (/\[\$num\]/i.test(source)) add("num");

  const userPassBlock =
    /<\?php\s+echo\s+"User:\s*"\s*\.\s*\$username\s*\.\s*"<br>Pass:\s*"\s*\.\s*\$password\s*;?\s*\?>/gi;
  if (userPassBlock.test(source)) {
    add("username");
    add("password");
  }

  const ordered: string[] = [];
  for (const k of CANONICAL_ORDER) {
    if (found.has(k)) ordered.push(k);
  }
  const rest = [...found].filter((k) => !(CANONICAL_ORDER as readonly string[]).includes(k)).sort();
  return [...ordered, ...rest];
}

export function ticketTemplateVarDescription(key: string): string {
  return TICKET_TEMPLATE_VAR_LABELS[key.toLowerCase()] ?? "Valeur injectée à l’impression";
}
