/**
 * Rendu côté client des modèles PHP/HTML (Mikhmon / nanoTECH) pour l’impression,
 * sans moteur PHP : mêmes variables que les fichiers .php d’origine.
 */

import { escapeHtml } from "@/lib/mikhmon-small-print";
import {
  getCustomDefault,
  getEditorLiveTicketTemplate,
} from "@/lib/voucher-ticket-defaults";
import {
  getPresetBody,
  getStoredTicketPresetId,
  findMatchingPresetId,
} from "@/lib/voucher-ticket-presets";
import { voucherTemplatePricePhpVarValue } from "@/lib/voucher-ticket-template-semantics";

const MKS = "<!--mks-mulai-->";

/** Clé numérique pour la palette nanoTECH (prix profil / vente, chiffres seuls). */
export function ticketPriceColorKey(priceStr: string): string {
  const m = String(priceStr ?? "").replace(/\s/g, "").match(/^(\d+)/);
  return m?.[1] ?? "0";
}

const COLOR_NORMAL: Record<string, string> = {
  "0": "#E50877",
  "100": "#752CEB",
  "200": "#804000",
  "300": "#13C013",
  "500": "#ECA352",
  "1000": "#F75418",
  "1500": "#FF69B4",
  "2500": "#F70000",
  "3000": "#F70000",
  "13000": "#2E8B57",
  "15000": "#2E8B57",
  "17000": "#0000FF",
  "20000": "#0000FF",
  "35000": "#6495ED",
  "40000": "#6495ED",
  "80000": "#FF8C00",
  "85000": "#FF8C00",
  "160000": "#DC143C",
  "170000": "#DC143C",
};

const COLOR_SMALL: Record<string, string> = {
  "0": "#13C013",
  "100": "#752CEB",
  "200": "#804000",
  "300": "#13C013",
  "500": "#ECA352",
  "1000": "#F75418",
  "1500": "#FF69B4",
  "3000": "#F70000",
  "13000": "#2E8B57",
  "15000": "#2E8B57",
  "17000": "#0000FF",
  "20000": "#0000FF",
  "35000": "#6495ED",
  "40000": "#6495ED",
  "80000": "#FF8C00",
  "85000": "#FF8C00",
  "160000": "#DC143C",
  "170000": "#DC143C",
};

const DEFAULT_COLOR = "#1433FD";

function nanoColor(getpriceKey: string, variant: "normal" | "small"): string {
  const map = variant === "normal" ? COLOR_NORMAL : COLOR_SMALL;
  return map[getpriceKey] ?? DEFAULT_COLOR;
}

function formatNanoValidity(raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  const last = v.slice(-1);
  const n = v.slice(0, -1);
  if (last === "d") return `Validité : ${n} Jour(s)`;
  if (last === "h") return `Validité : ${n} Heure(s)`;
  if (last === "w") return `Validité : ${n} Semaine(s)`;
  return v;
}

function formatNanoTimelimit(raw: string, variant: "normal" | "small"): string {
  const t = raw.trim();
  if (!t) return "";
  const last = t.slice(-1);
  const prefix = variant === "normal" ? "Durasi" : "Durée";
  if (last === "d") {
    if (t.length > 3) {
      const head = t.slice(0, -1);
      const n = parseInt(head, 10);
      const midDigit = parseInt(t.charAt(2), 10) || 0;
      const val = n * 7 + midDigit;
      return `${prefix}:${val} HARI`;
    }
    const n = t.slice(0, -1);
    return `${prefix}:${n} Jour(s)`;
  }
  if (last === "h") {
    const n = t.slice(0, -1);
    return `${prefix}:${n}Heure(s)`;
  }
  if (last === "w") {
    const n = parseInt(t.slice(0, -1), 10) || 0;
    return `${prefix}:${n * 7} Semaine(s)`;
  }
  return t;
}

function nanoVariantFromTemplate(full: string): "normal" | "small" {
  return full.includes("width: 215px") ? "normal" : "small";
}

function applyUsermodeBranches(html: string, mode: "vc" | "up"): string {
  const re =
    /<\?php\s+if\s*\(\s*\$usermode\s*==\s*"vc"\s*\)\s*\{\s*\?>([\s\S]*?)<\?php\s*\}\s*elseif\s*\(\s*\$usermode\s*==\s*"up"\s*\)\s*\{\s*\?>([\s\S]*?)<\?php\s*\}\s*\?>/gi;
  let out = html;
  let prev = "";
  while (out !== prev) {
    prev = out;
    out = out.replace(re, (_, vc: string, up: string) => (mode === "vc" ? vc : up));
  }
  return out;
}

function substituteTicketVars(html: string, vars: Record<string, string>, qrcodeRaw: string): string {
  let s = html;
  s = s.replace(/<\?=\s*\$qrcode\s*\?>/g, qrcodeRaw);
  s = s.replace(/<\?php\s+echo\s+\$qrcode\s*;?\s*\?>/g, qrcodeRaw);

  s = s.replace(
    /<\?php\s+echo\s+"User:\s*"\s*\.\s*\$username\s*\.\s*"<br>Pass:\s*"\s*\.\s*\$password\s*;\s*\?>/gi,
    `User: ${escapeHtml(vars.username)}<br>Pass: ${escapeHtml(vars.password)}`,
  );
  s = s.replace(/<\?php\s+echo\s+"\s+\[\$num\]"\s*;\s*\?>/g, ` [${escapeHtml(vars.num)}]`);
  s = s.replace(/<\?php\s+echo\s+"\s*\[\$num\]"\s*;\s*\?>/g, ` [${escapeHtml(vars.num)}]`);
  s = s.replace(/<\?=\s*"\s+\[\$num\]"\s*;\s*\?>/g, ` [${escapeHtml(vars.num)}]`);
  s = s.replace(/<\?=\s*"\s*\[\$num\]"\s*;\s*\?>/g, ` [${escapeHtml(vars.num)}]`);
  /* Modèle nanoTECH : balise PHP parfois coupée avant ?> */
  s = s.replace(/<\?=\s*"\s*\[\$num\]"\s*;\s*/g, ` [${escapeHtml(vars.num)}]`);

  const echoPhp = /<\?php\s+echo\s+\$([a-zA-Z_][a-zA-Z0-9_]*)\s*;?\s*\?>/g;
  s = s.replace(echoPhp, (_, name: string) => {
    const k = name.toLowerCase();
    if (k === "qrcode") return qrcodeRaw;
    return escapeHtml(vars[k] ?? "");
  });

  const echoShort = /<\?=\s*\$([a-zA-Z_][a-zA-Z0-9_]*)\s*;?\s*\?>/g;
  s = s.replace(echoShort, (_, name: string) => {
    const k = name.toLowerCase();
    if (k === "qrcode") return qrcodeRaw;
    return escapeHtml(vars[k] ?? "");
  });

  return s;
}

export type VoucherTicketPrintRow = {
  hotspotName: string;
  num: number;
  usermode: "vc" | "up";
  username: string;
  password: string;
  /** Brut (ex. 1d) — format nanoTECH appliqué si le modèle l’utilise. */
  validityRaw: string;
  timelimitRaw: string;
  datalimit: string;
  /** Libellé tarifaire / montant forfait (hors variable PHP `$price` — voir `voucher-ticket-template-semantics.ts`). */
  priceDisplay: string;
  /** Clé couleur nanoTECH (chiffres, ex. profil.price). */
  getpriceKey: string;
  currency: string;
  /** Texte injecté dans `$dnsname` (= contact routeur, pas l’hôte API). */
  dnsname: string;
  /** Fragment HTML attributs image QR (ex. `src="data:image/png;base64,..."`) ou vide. */
  qrcode: string;
};

function buildVarMap(row: VoucherTicketPrintRow, nano: null | { variant: "normal" | "small"; color: string; validity: string; timelimit: string }): Record<string, string> {
  const num = String(row.num);
  /** `$price` en PHP = devise (contrat produit, voir `voucher-ticket-template-semantics.ts`). */
  const base: Record<string, string> = {
    hotspotname: row.hotspotName,
    num,
    username: row.username,
    password: row.password,
    datalimit: row.datalimit,
    price: voucherTemplatePricePhpVarValue(row.currency),
    getprice: row.getpriceKey,
    currency: row.currency,
    dnsname: row.dnsname,
  };
  if (nano) {
    return {
      ...base,
      color: nano.color,
      validity: nano.validity,
      timelimit: nano.timelimit,
    };
  }
  return {
    ...base,
    color: "",
    validity: row.validityRaw,
    timelimit: row.timelimitRaw,
  };
}

/**
 * Transforme le fichier modèle (PHP) en HTML imprimable pour un voucher.
 */
export function renderVoucherTicketHtml(template: string, row: VoucherTicketPrintRow): string {
  const full = template;
  const idx = full.indexOf(MKS);
  if (idx !== -1) {
    const variant = nanoVariantFromTemplate(full);
    const color = nanoColor(row.getpriceKey, variant);
    const validity = formatNanoValidity(row.validityRaw);
    const timelimit = formatNanoTimelimit(row.timelimitRaw, variant);
    let body = full.slice(idx);
    const vars = buildVarMap(row, { variant, color, validity, timelimit });
    body = applyUsermodeBranches(body, row.usermode);
    return substituteTicketVars(body, vars, row.qrcode);
  }

  let body = full;
  const vars = buildVarMap(row, null);
  body = applyUsermodeBranches(body, row.usermode);
  return substituteTicketVars(body, vars, row.qrcode);
}

export function renderVoucherTicketsBody(template: string, rows: VoucherTicketPrintRow[]): string {
  return rows.map((r) => renderVoucherTicketHtml(template, r)).join("\n");
}

/**
 * Modèle effectif pour impression :
 * 1) Texte actuel de l’éditeur « Modèle de ticket » (localStorage), s’il est présent ;
 * 2) sinon relu sur le serveur (pas de cache HTTP) ;
 * 3) sinon défaut local / préréglage stocké.
 */
export async function fetchEffectiveTicketTemplate(apiBase: string): Promise<string> {
  const live = getEditorLiveTicketTemplate();
  if (live) {
    const id = findMatchingPresetId(live);
    if (id !== "custom") return getPresetBody(id);
    return live;
  }

  let fromServer = "";
  try {
    const r = await fetch(`${apiBase}/api/tenant/ticket-template`, { cache: "no-store" });
    if (r.ok) {
      const data = (await r.json()) as { template?: string | null };
      fromServer = data.template?.trim() ?? "";
    }
  } catch {
    /* ignore */
  }
  if (fromServer) {
    const id = findMatchingPresetId(fromServer);
    if (id !== "custom") return getPresetBody(id);
    return fromServer;
  }
  return getCustomDefault() || getPresetBody(getStoredTicketPresetId());
}

const ADMIN_TOKEN_KEY = "vouchernet_admin_token";

function readAdminTokenForTemplate(): string | null {
  try {
    return localStorage.getItem(ADMIN_TOKEN_KEY) ?? sessionStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Pousse le modèle « live » de l’éditeur vers le serveur (`PUT /api/tenant/ticket-template`)
 * pour que d’autres clients ou l’endpoint `voucher-print-small` voient le même gabarit.
 */
export async function flushEditorLiveTicketTemplateToServer(apiBase: string): Promise<void> {
  const live = getEditorLiveTicketTemplate();
  const token = readAdminTokenForTemplate();
  if (!live?.trim() || !token) return;
  const prefix = apiBase.replace(/\/$/, "");
  try {
    await fetch(`${prefix}/api/tenant/ticket-template`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ template: live }),
      cache: "no-store",
    });
  } catch {
    /* ignore — l’impression client utilisera quand même le live via fetchEffectiveTicketTemplate */
  }
}
