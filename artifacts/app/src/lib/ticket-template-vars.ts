/**
 * Détection des variables PHP affichées dans un modèle de ticket (aligné sur
 * `substituteTicketVars` dans `voucher-ticket-render.ts`).
 */

/** Libellés FR pour les clés connues — alignés sur `voucher-ticket-template-semantics.ts` + substitution. */
export const TICKET_TEMPLATE_VAR_LABELS: Record<string, string> = {
  logo: "Logo (URL ou chemin)",
  hotspotname: "Nom du Wi‑Fi (variable `$hotspotname`)",
  num: "Numéro du ticket",
  username: "Identifiant",
  password: "Mot de passe",
  validity: "Validité",
  timelimit: "Durée / limite",
  datalimit: "Quota données",
  price: "Devise (variable `$price`, ex. FCFA)",
  profile: "Profil hotspot",
  comment: "Commentaire / lot",
  getprice: "Montant clé (palette couleur)",
  currency: "Devise (rappel — identique à `$price` dans cette app)",
  dnsname: "Contact routeur (variable `$dnsname`, champ contact)",
  color: "Couleur d’accent",
  qrcode: "QR code",
};

const CANONICAL_ORDER = [
  "logo",
  "hotspotname",
  "username",
  "password",
  "validity",
  "timelimit",
  "datalimit",
  "price",
  "profile",
  "comment",
  "dnsname",
  "qrcode",
  "num",
  "getprice",
  "currency",
  "color",
] as const;

/** Référence d’affichage (style MikHmon) — ordre et extraits demandés pour la carte « Variables ». */
export type TicketTemplateVarRefEntry = {
  title: string;
  code: string;
};

export const TICKET_TEMPLATE_VAR_REFERENCE: TicketTemplateVarRefEntry[] = [
  {
    title: "Logo",
    code: '<img src="<?= $logo; ?>" style="height:30px;border:0;">',
  },
  { title: "Hotspotname", code: "<?= $hotspotname; ?>" },
  { title: "Username", code: "<?= $username; ?>" },
  { title: "Password", code: "<?= $password; ?>" },
  { title: "Validity", code: "<?= $validity; ?>" },
  { title: "Time Limit", code: "<?= $timelimit; ?>" },
  { title: "Data Limit", code: "<?= $datalimit; ?>" },
  { title: "Price (= devise)", code: "<?= $price; ?>" },
  { title: "Profile", code: "<?= $profile; ?>" },
  { title: "Comment", code: "<?= $comment; ?>" },
  { title: "DNS / contact (routeur)", code: "<?= $dnsname; ?>" },
  { title: "QR Code", code: "<?= $qrcode ?>" },
  {
    title: "Number Voucher",
    code: '<?= $num; ?>\n<span id="num"><?= " [$num]"; ?></span>',
  },
];

/** Bloc conditionnel géré par l’impression (voucher / même mot de passe). */
export const TICKET_TEMPLATE_VAR_REFERENCE_CONDITIONAL = {
  title: "Conditional",
  body: `$usermode = "vc"\nusername = password\n\n$usermode = "up"\nusername & password`,
  /** Gabarit PHP attendu par le moteur d’impression (branches vc / up). */
  templateHint:
    '<?php if($usermode == "vc"){?> … <?php }elseif($usermode == "up"){?> … <?php }?>',
} as const;

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
