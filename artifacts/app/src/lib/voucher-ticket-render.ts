/**
 * Rendu côté client des modèles PHP/HTML (Mikhmon / nanoTECH) pour l’impression,
 * sans moteur PHP : mêmes variables que les fichiers .php d’origine.
 */

import { escapeHtml } from "@/lib/mikhmon-small-print";
import {
  getCustomDefault,
} from "@/lib/voucher-ticket-defaults";
import {
  fetchAndApplyServerTicketTemplates,
  getPresetBody,
  resolveTicketTemplateDisplayBody,
  resolveTicketTemplateSelection,
  setStoredTicketPresetId,
} from "@/lib/voucher-ticket-presets";

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

/**
 * Mikhmon (small) n’affiche que `<?php echo $price; ?>` — y inclure la devise
 * si le montant ne la contient pas déjà.
 */
function formatMikhmonTicketPrice(amount: string, currency: string): string {
  const a = (amount ?? "").trim();
  const c = (currency ?? "").trim();
  if (!a) return "";
  if (!c) return a;
  if (a.toLowerCase().includes(c.toLowerCase())) return a;
  return `${a} ${c}`;
}

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
  /** Tarif forfait → `$price` ; devise routeur → `$currency`. */
  priceDisplay: string;
  /** Clé couleur nanoTECH (chiffres, ex. profil.price). */
  getpriceKey: string;
  currency: string;
  dnsname: string;
  /** Fragment HTML attributs image QR (ex. `src="data:image/png;base64,..."`) ou vide. */
  qrcode: string;
};

function buildVarMap(row: VoucherTicketPrintRow, nano: null | { variant: "normal" | "small"; color: string; validity: string; timelimit: string }): Record<string, string> {
  const num = String(row.num);
  const priceAmount = (row.priceDisplay ?? "").trim();
  const base: Record<string, string> = {
    hotspotname: row.hotspotName,
    num,
    username: row.username,
    password: row.password,
    datalimit: row.datalimit,
    getprice: row.getpriceKey,
    currency: row.currency,
    dnsname: row.dnsname,
  };
  if (nano) {
    return {
      ...base,
      /** nanoTECH : `$getprice` + `$currency` dans le gabarit. */
      price: priceAmount,
      color: nano.color,
      validity: nano.validity,
      timelimit: nano.timelimit,
    };
  }
  return {
    ...base,
    /** Mikhmon (small) : `$price` seul → montant + devise. */
    price: formatMikhmonTicketPrice(priceAmount, row.currency),
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

/** Vrai si le gabarit contient `<?= $qrcode ?>` (ou variante echo PHP). */
export function ticketTemplateUsesQrcode(template: string): boolean {
  return /\$qrcode/i.test(template);
}

/**
 * Modèle effectif pour l'impression : même résolution que {@link TicketTemplateEditor}
 * (presetId en base + corps enregistré + modèles intégrés serveur).
 *
 * Utilise `/api/tenant/ticket-template` (admin, manager, collaborateur, vendeur → tenant owner)
 * et n'applique le localStorage qu'en cas d'échec API (pas quand le super-admin a validé
 * un preset pour le compte cible).
 */
export async function fetchEffectiveTicketTemplate(apiBase: string): Promise<string> {
  await fetchAndApplyServerTicketTemplates({});

  let templateBody = "";
  let serverPresetId: unknown = null;
  let apiOk = false;

  try {
    const r = await fetch(`${apiBase}/api/tenant/ticket-template`);
    if (r.ok) {
      apiOk = true;
      const data = (await r.json()) as { template?: string | null; presetId?: string | null };
      templateBody = data.template?.trim() ?? "";
      serverPresetId = data.presetId;
    }
  } catch {
    /* ignore */
  }

  const resolved = resolveTicketTemplateSelection({
    templateBody,
    serverPresetId,
    skipLocalFallback: apiOk,
  });

  const display = resolveTicketTemplateDisplayBody(templateBody, resolved);
  if (display.trim()) {
    if (apiOk) setStoredTicketPresetId(resolved);
    return display;
  }

  if (resolved !== "custom") {
    if (apiOk) setStoredTicketPresetId(resolved);
    return getPresetBody(resolved);
  }

  return getCustomDefault() || "";
}
