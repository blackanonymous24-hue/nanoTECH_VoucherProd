/**
 * Rendu HTML d’impression vouchers (équivalent Mikhmon v3 `voucher/print.php`) côté API.
 * Logique alignée sur `artifacts/app/src/lib/voucher-ticket-render.ts` et `mikhmon-small-print.ts`.
 *
 * Gabarits : fichiers sous `ticket-templates/` lus depuis le disque (compatible `tsx` en dev ;
 * en prod le build copie ce dossier à côté de `dist/index.js`).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import type { HotspotProfile, HotspotUser } from "./mikrotik.js";
import { buildHotspotLoginUrl } from "./voucher-login-qr-url.js";
import { voucherTemplatePricePhpVarValue } from "./voucher-ticket-template-semantics.js";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

function readEmbeddedTicketTemplate(filename: string): string {
  const p = join(MODULE_DIR, "ticket-templates", filename);
  if (!existsSync(p)) {
    throw new Error(
      `Gabarit ticket introuvable : ${p}. En prod, exécuter le build api-server (copie des .php.txt vers dist/).`,
    );
  }
  return readFileSync(p, "utf8");
}

const UNITS = ["Byte", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"] as const;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatMikhmonBytes(raw: string | number | null | undefined): string {
  let size = typeof raw === "number" ? raw : parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(size) || size <= 0) return "";
  let i = 0;
  for (; size >= 1024 && i < UNITS.length - 1; i++) {
    size /= 1024;
  }
  return `${size.toFixed(2)} ${UNITS[i]}`;
}

export function mikhmonProfilePriceLabel(p?: { price?: string | null; sellingPrice?: string | null } | null): string {
  if (!p) return "";
  const sp = String(p.sellingPrice ?? "").trim();
  const pr = String(p.price ?? "").trim();
  const isZero = (s: string) => {
    const n = parseFloat(s.replace(",", "."));
    return s === "" || (Number.isFinite(n) && n === 0);
  };
  if (sp && !isZero(sp)) return sp;
  if (pr && !isZero(pr)) return pr;
  return "";
}

export function inferMikhmonUserMode(
  comment: string | null | undefined,
  username: string,
  password: string,
): "vc" | "up" {
  const first = (comment ?? "").split("-")[0]?.toLowerCase() ?? "";
  if (first === "vc") return "vc";
  if (first === "up") return "up";
  return username === password ? "vc" : "up";
}

type TicketTemplatePresetId = "mikhmon-small" | "nanotech-normal" | "nanotech-small";

const DEFAULT_TICKET_PRESET_ID: TicketTemplatePresetId = "mikhmon-small";

const BODIES: Record<TicketTemplatePresetId, string> = {
  "mikhmon-small": readEmbeddedTicketTemplate("mikhmon-small.php.txt"),
  "nanotech-normal": readEmbeddedTicketTemplate("nanotech-normal.php.txt"),
  "nanotech-small": readEmbeddedTicketTemplate("nanotech-small.php.txt"),
};

function normalizeTicketTemplateBody(s: string): string {
  return s.trim().replace(/\r\n/g, "\n");
}

function findMatchingPresetId(code: string): TicketTemplatePresetId | "custom" {
  const t = normalizeTicketTemplateBody(code);
  for (const id of Object.keys(BODIES) as TicketTemplatePresetId[]) {
    if (normalizeTicketTemplateBody(BODIES[id]) === t) return id;
  }
  return "custom";
}

function getPresetBody(id: TicketTemplatePresetId): string {
  return BODIES[id];
}

/**
 * Même règle que le client `fetchEffectiveTicketTemplate`, sans localStorage :
 * gabarit embarqué si le contenu DB est strictement identique à un des trois fichiers ;
 * sinon le texte DB tel quel (personnalisé) ; sinon Mikhmon (small).
 */
export function resolveEffectiveTicketTemplate(fromDb: string | null | undefined): string {
  const fromServer = (fromDb ?? "").trim();
  if (fromServer) {
    const id = findMatchingPresetId(fromServer);
    if (id !== "custom") return getPresetBody(id);
    return fromServer;
  }
  return getPresetBody(DEFAULT_TICKET_PRESET_ID);
}

const MKS = "<!--mks-mulai-->";

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
  validityRaw: string;
  timelimitRaw: string;
  datalimit: string;
  /** Libellé tarifaire / montant forfait (hors variable PHP `$price` — voir `voucher-ticket-template-semantics.ts`). */
  priceDisplay: string;
  getpriceKey: string;
  currency: string;
  /** Texte injecté dans `$dnsname` (= contact routeur, pas l’hôte API). */
  dnsname: string;
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

/** Feuille de styles Mikhmon v3 `voucher/print.php`. */
export const MIKHMON_VOUCHER_PRINT_CSS = `
body {
  color: #000000;
  background-color: #FFFFFF;
  font-size: 14px;
  font-family:  'Helvetica', arial, sans-serif;
  margin: 0px;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
table.voucher {
  display: inline-block;
  border: 2px solid black;
  margin: 2px;
}
@page
{
  size: auto;
  margin-left: 7mm;
  margin-right: 3mm;
  margin-top: 9mm;
  margin-bottom: 3mm;
}
@media print
{
  table { page-break-after:auto }
  tr    { page-break-inside:avoid; page-break-after:auto }
  td    { page-break-inside:avoid; page-break-after:auto }
  thead { display:table-header-group }
  tfoot { display:table-footer-group }
}
#num {
  float:right;
  display:inline-block;
}
.qrc {
  width:30px;
  height:30px;
  margin-top:1px;
}
img.vn-voucher-qr {
  max-width: min(38px, 40%) !important;
  max-height: min(38px, 40%) !important;
  width: auto !important;
  height: auto !important;
  object-fit: contain;
  box-sizing: border-box;
}
.vn-voucher-scale-wrap {
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
`;

function wrapVoucherBodyWithPrintScale(bodyTicketsHtml: string, scalePercent: number): string {
  const pct = Math.max(0, Math.min(100, Math.round(scalePercent)));
  if (pct >= 100) return bodyTicketsHtml;
  const z = pct <= 0 ? 1 : pct;
  return `<div class="vn-voucher-scale-wrap" style="zoom:${z}%;box-sizing:border-box">${bodyTicketsHtml}</div>`;
}

export function buildStandaloneVoucherPrintHtml(
  documentTitle: string,
  bodyTicketsHtml: string,
  opts?: { deferPrintMs?: number; scalePercent?: number },
): string {
  const scale = opts?.scalePercent ?? 100;
  const body = wrapVoucherBodyWithPrintScale(bodyTicketsHtml, scale);
  const safeTitle = documentTitle.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const defer = opts?.deferPrintMs ?? 0;
  const printScript =
    defer > 0
      ? `window.onload=function(){window.focus();setTimeout(function(){window.print();},${defer});};`
      : `window.onload=function(){window.focus();window.print();};`;
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${safeTitle}</title>
    <style>${MIKHMON_VOUCHER_PRINT_CSS}</style>
    <script>${printScript}<\/script>
  </head>
  <body>${body}</body>
</html>`;
}

const VOUCHER_QR_PNG_OPTS = {
  type: "image/png" as const,
  width: 64,
  margin: 1,
  errorCorrectionLevel: "L" as const,
};

async function voucherQrImgAttrsServer(loginHost: string, username: string, password: string): Promise<string> {
  const loginUrl = buildHotspotLoginUrl(loginHost, username, password);
  if (!loginUrl) return 'class="vn-voucher-qr" src="" alt=""';
  try {
    const dataUrl = await QRCode.toDataURL(loginUrl, VOUCHER_QR_PNG_OPTS);
    return `class="vn-voucher-qr" src="${dataUrl}" alt="" decoding="async"`;
  } catch {
    return 'class="vn-voucher-qr" src="" alt=""';
  }
}

/** Remplit `qrcode` sur chaque ligne (PNG 64 px intrinsèque, sans width/height HTML), en parallèle. */
export async function attachVoucherQrCodesToRows(
  rows: VoucherTicketPrintRow[],
  loginHost: string,
): Promise<VoucherTicketPrintRow[]> {
  const host = loginHost.trim();
  if (!host) return rows.map((r) => ({ ...r, qrcode: 'class="vn-voucher-qr" src="" alt=""' }));
  const attrs = await Promise.all(rows.map((r) => voucherQrImgAttrsServer(host, r.username, r.password)));
  return rows.map((row, i) => ({ ...row, qrcode: attrs[i] ?? 'class="vn-voucher-qr" src="" alt=""' }));
}

export function buildVoucherPrintRows(params: {
  hotspotName: string;
  currency: string;
  dnsname: string;
  users: HotspotUser[];
  profByName: Map<string, HotspotProfile>;
}): VoucherTicketPrintRow[] {
  const { hotspotName, currency, dnsname, users, profByName } = params;
  return users.map((u, i) => {
    const p = profByName.get(u.profile);
    const priceStr = mikhmonProfilePriceLabel(p);
    const rawPriceKey = String(p?.sellingPrice ?? p?.price ?? "").trim();
    return {
      hotspotName,
      num: i + 1,
      usermode: inferMikhmonUserMode(u.comment, u.username, u.password),
      username: u.username,
      password: u.password,
      validityRaw: String(p?.validity ?? "").trim(),
      timelimitRaw: String(u.limitUptime ?? "").trim(),
      datalimit: formatMikhmonBytes(u.limitBytesTotal),
      priceDisplay: priceStr,
      getpriceKey: ticketPriceColorKey(rawPriceKey || priceStr),
      currency,
      dnsname,
      qrcode: "",
    };
  });
}
