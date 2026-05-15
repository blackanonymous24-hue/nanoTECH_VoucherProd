import {
  getVoucherPrintScalePercent,
  getVoucherPrintZoomFactorFromPercent,
} from "@/lib/voucher-print-scale";

const REPORT_CSS = `
  body {
    color:#111; background:#fff; font-size:12px;
    font-family:Arial, sans-serif; margin:0; padding:20px 28px;
    -webkit-print-color-adjust:exact; print-color-adjust:exact;
  }
  @page { size:auto; margin:0; }
  @media print {
    tr { page-break-inside:avoid; }
    thead { display:table-header-group; }
    tfoot { display:table-footer-group; }
  }
  .report-print-table {
    width:100%; border-collapse:collapse; margin-bottom:16px; font-size:12px;
  }
  .report-print-table th,
  .report-print-table td { border:1px solid #ccc; padding:5px 8px; text-align:left; }
  .report-print-table th { background:#f3f4f6; font-weight:600; }
  .report-print-table tfoot td { font-weight:700; background:#f9fafb; }
  .report-print-title { font-size:16px; font-weight:700; margin-bottom:2px; }
  .report-print-meta { font-size:11px; color:#555; margin-bottom:14px; }
  .report-print-section-label {
    font-size:12px; font-weight:700; text-transform:uppercase;
    letter-spacing:0.04em; margin:14px 0 4px; color:#374151;
  }
`;

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(data: string): void };
  }
}

function isNativeWebView(): boolean {
  return typeof window !== "undefined" && !!window.ReactNativeWebView;
}

function isMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  if (/Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) return true;
  // iPadOS 13+ s'identifie comme Macintosh mais possède le multi-touch
  if (navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent)) return true;
  return false;
}

/** Navigateur mobile ou APK : layout + zoom d’impression dédiés (Safari / WebView gèrent mal `zoom` sur `html`). */
function isVoucherPrintMobileLayout(): boolean {
  return isNativeWebView() || isMobile();
}

/**
 * Impression depuis une page HTML complète (rapports vendeur, etc.).
 * — APK (React Native WebView) : postMessage → expo-print
 * — Navigateur mobile : nouvel onglet + document.write
 */
export function openPrintHtmlWindow(html: string, title: string): void {
  if (isNativeWebView()) {
    printWithNativeBridge(html, title);
    return;
  }

  const win = window.open("", "_blank");
  if (!win) return;
  win.document.open();
  win.document.write(html);
  win.document.close();
  try {
    win.document.title = title;
    const te = win.document.querySelector("title");
    if (te) te.textContent = title;
  } catch {
    /* ignore */
  }
  try {
    win.focus();
  } catch {
    /* ignore */
  }
}

function buildReportHtml(bodyHtml: string, title: string, autoprint = true): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>${REPORT_CSS}</style>
    ${autoprint ? `<script>window.onload=function(){window.focus();window.print();}<\/script>` : ""}
  </head>
  <body>${bodyHtml}</body>
</html>`;
}

/**
 * Document HTML autonome pour l’impression (suivi vendeurs, hebdo, etc.).
 */
export function buildStandalonePrintHtml(title: string, styleCss: string, bodyHtml: string): string {
  const safeTitle = title.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${safeTitle}</title>
    <style>${styleCss}</style>
    <script>window.onload=function(){window.focus();window.print();}<\/script>
  </head>
  <body>${bodyHtml}</body>
</html>`;
}

/**
 * Styles additionnels impression mobile / WebView.
 * Sur ÉCRAN : affichage libre pour prévisualisation.
 * Sur IMPRESSION : voir mobileScaleCss dans buildMikhmonVoucherPrintDocumentHtml.
 */
function buildVoucherPrintMobileLayoutCss(): string {
  return `@page {
  size: auto;
  margin: 2mm;
}
html.vn-print-mobile {
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}
html.vn-print-mobile body {
  margin: 0 !important;
  padding: 0 !important;
  width: 100% !important;
  max-width: 100% !important;
  overflow-x: visible !important;
}
html.vn-print-mobile #vn-print-scale-root {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-start;
  align-content: flex-start;
  align-items: flex-start;
  width: 100% !important;
  max-width: 100% !important;
  box-sizing: border-box !important;
  overflow: visible !important;
}
html.vn-print-mobile .vn-ticket-row {
  display: block !important;
  break-inside: avoid !important;
  page-break-inside: avoid !important;
  font-size: 0;
}
html.vn-print-mobile .vn-ticket-row > table {
  display: inline-block !important;
  vertical-align: top !important;
  box-sizing: border-box !important;
  margin: 2mm !important;
  font-size: 12px;
}
`;
}

/**
 * Extrait les éléments `<table>` racines depuis le HTML concaténé des tickets.
 * Gère l'imbrication (mikhmon-small a 3 niveaux de tables).
 */
function splitVoucherTickets(html: string): string[] {
  const tickets: string[] = [];
  const lower = html.toLowerCase();
  let depth = 0;
  let start = -1;
  let i = 0;
  while (i < lower.length) {
    const nextOpen = lower.indexOf('<table', i);
    const nextClose = lower.indexOf('</table>', i);
    if (nextOpen === -1 && nextClose === -1) break;
    if (nextClose === -1 || (nextOpen !== -1 && nextOpen < nextClose)) {
      if (depth === 0) start = nextOpen;
      depth++;
      i = nextOpen + 6;
    } else {
      depth = Math.max(0, depth - 1);
      const closeEnd = nextClose + 8;
      if (depth === 0 && start !== -1) {
        tickets.push(html.slice(start, closeEnd));
        start = -1;
      }
      i = closeEnd;
    }
  }
  return tickets;
}

/**
 * Détecte la largeur en pixels du premier ticket racine via son attribut/style `width`.
 * Fallback : 160 (largeur Mikhmon par défaut). Couvre Mikhmon (160), nanoTECH small (135),
 * nanoTECH normal (215), etc.
 */
function detectTicketWidthPx(firstTicketHtml: string | undefined): number {
  if (!firstTicketHtml) return 160;
  // Lit la 1ʳᵉ balise <table ...> uniquement (pas les enfants)
  const openTagMatch = firstTicketHtml.match(/<table\b[^>]*>/i);
  if (!openTagMatch) return 160;
  const openTag = openTagMatch[0];
  // Cherche style="...width: Npx..."
  const styleMatch = openTag.match(/style\s*=\s*["'][^"']*?width\s*:\s*(\d+(?:\.\d+)?)\s*px/i);
  if (styleMatch) return Math.round(parseFloat(styleMatch[1]));
  // Cherche attribut width="N" ou width=N
  const attrMatch = openTag.match(/\bwidth\s*=\s*["']?(\d+(?:\.\d+)?)/i);
  if (attrMatch) return Math.round(parseFloat(attrMatch[1]));
  return 160;
}

/**
 * Document d’impression vouchers — même principe que `mikhmonv3/voucher/print.php` :
 * nouvel onglet, HTML complet, `&lt;body onload="window.print()"&gt;` (pas d’iframe, pas d’autre déclencheur).
 */
function buildMikhmonVoucherPrintDocumentHtml(documentTitle: string, bodyTicketsHtml: string): string {
  const safeTitle = documentTitle.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const mobile = isVoucherPrintMobileLayout();
  const zoom = getVoucherPrintZoomFactorFromPercent(getVoucherPrintScalePercent());
  const zf = Number(zoom.toFixed(6));

  // Desktop : `html { zoom }` — bien pris en charge par Chromium.
  const zoomRuleDesktop = !mobile && zoom !== 1 ? `html { zoom: ${zf}; }\n` : "";

  // ── Mobile print scaling ──────────────────────────────────────────────────
  //
  // ── Approche unifiée : unités physiques mm ──────────────────────────────────
  //
  // Le navigateur (desktop ET mobile) mappe les CSS `mm` directement sur le papier
  // physique. En fixant `body { width: A4_MM mm }` + `@page { size: A4 }`, le layout
  // est identique partout, quelle que soit la densité de l'écran ou le viewport mobile.
  //
  // A4 imprimable ≈ 210 mm − 5 mm marges × 2 = 200 mm
  // À l'échelle zf ≠ 1 : le conteneur est élargi à (200/zf) mm + zoom: zf CSS
  //   → visuel = 200 mm, mais plus de colonnes tiennent dans la grille logique.
  //
  // ── Mobile : pré-découpe en rangées-blocs pour pagination fiable ─────────
  //
  // Sur les 3 plateformes mobiles testées (Android Chrome, iPhone Safari, iPhone Chrome),
  // `break-inside: avoid` sur des enfants flex est ignoré → tickets coupés entre pages.
  // Solution fiable cross-browser : grouper N tickets dans un `<div class="vn-ticket-row">`
  // bloc, sur lequel `break-inside: avoid` est honoré universellement.
  //
  // Largeur réelle détectée depuis le HTML (Mikhmon=160px, nanoTECH small=135px,
  // nanoTECH normal=215px) → numCols correct quel que soit le template.
  const A4_MM = 200; // A4 imprimable (210 mm − marges 5 mm × 2)
  const gridMm = zoom !== 1 ? (A4_MM / zf) : A4_MM;
  const gridWidthPx = Math.round((gridMm / 25.4) * 96);
  const TICKET_MARGIN_PX = Math.round((4 / 25.4) * 96); // 2mm × 2 côtés ≈ 15 px

  let processedBodyHtml = bodyTicketsHtml;
  if (mobile) {
    const tickets = splitVoucherTickets(bodyTicketsHtml);
    if (tickets.length > 0) {
      const ticketWidthPx = detectTicketWidthPx(tickets[0]);
      const effectiveWidth = ticketWidthPx + TICKET_MARGIN_PX;
      const numCols = Math.max(1, Math.floor(gridWidthPx / effectiveWidth));
      const rows: string[] = [];
      for (let r = 0; r < tickets.length; r += numCols) {
        rows.push(`<div class="vn-ticket-row">${tickets.slice(r, r + numCols).join("")}</div>`);
      }
      processedBodyHtml = rows.join("");
    }
  }

  // ── CSS impression mobile : unités mm, @page A4 ──────────────────────────
  let mobileScaleCss = "";
  if (mobile) {
    mobileScaleCss =
      `@media print {\n` +
      `  @page { size: A4 portrait; margin: 5mm; }\n` +
      `  html.vn-print-mobile body {\n` +
      `    width: ${A4_MM}mm !important;\n` +
      `    margin: 0 !important;\n` +
      `    padding: 0 !important;\n` +
      `    max-width: none !important;\n` +
      `  }\n` +
      `  html.vn-print-mobile #vn-print-scale-root {\n` +
      `    display: block !important;\n` +
      `    width: ${A4_MM}mm !important;\n` +
      `    max-width: none !important;\n` +
      `  }\n` +
      `  html.vn-print-mobile .vn-ticket-row {\n` +
      `    width: ${gridMm.toFixed(2)}mm !important;\n` +
      `    max-width: none !important;\n` +
      `    white-space: nowrap !important;\n` +
      (zoom !== 1 ? `    zoom: ${zf} !important;\n` : ``) +
      `  }\n` +
      `}\n`;
  }

  const mobileLayoutCss = mobile ? buildVoucherPrintMobileLayoutCss() : "";
  const bodyInner = mobile
    ? `<div id="vn-print-scale-root">${processedBodyHtml}</div>`
    : bodyTicketsHtml;

  // Sur mobile : délai 400 ms pour laisser le moteur de rendu appliquer le zoom
  // avant l'ouverture de la boîte de dialogue d'impression.
  const onload = mobile
    ? `setTimeout(function(){try{window.focus();}catch(_){}window.print();},400)`
    : `window.print()`;

  const viewport = mobile
    ? `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, viewport-fit=cover" />`
    : `<meta name="viewport" content="width=device-width, initial-scale=1" />`;
  const htmlClass = mobile ? ` class="vn-print-mobile"` : "";
  const bodyClass = mobile ? ` class="vn-print-mobile-body"` : "";
  return `<!doctype html>
<html${htmlClass}>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta http-equiv="pragma" content="no-cache" />
    ${viewport}
    <title>${safeTitle}</title>
    <style>${zoomRuleDesktop}${MIKHMON_VOUCHER_PRINT_CSS}${mobileLayoutCss}${mobileScaleCss}</style>
  </head>
  <body${bodyClass} onload="${onload}">${bodyInner}</body>
</html>`;
}

/** Feuille de styles de `mikhmonv3/voucher/print.php` (bloc &lt;style&gt; du &lt;head&gt;). */
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
  table.voucher {
    page-break-inside: avoid;
    break-inside: avoid;
    display: inline-block !important;
  }
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
`;

/**
 * Impression vouchers — **un seul flux**, aligné sur Mikhmon v3 (`voucher/print.php`) :
 * `window.open` + document HTML complet + `body onload="window.print()"`.
 * (WebView native : pont d’impression, seul environnement sans `window.open` utilisable.)
 */
export function printMikhmonSmallVouchers(bodyTicketsHtml: string, documentTitle: string): void {
  const html = buildMikhmonVoucherPrintDocumentHtml(documentTitle, bodyTicketsHtml);

  if (isNativeWebView()) {
    printWithNativeBridge(html, documentTitle);
    return;
  }

  openPrintHtmlWindow(html, documentTitle);
}

function printWithNativeBridge(html: string, title: string): void {
  const MAX_CHUNK = 500_000;
  if (html.length <= MAX_CHUNK) {
    window.ReactNativeWebView!.postMessage(JSON.stringify({ type: "print", html, title }));
    return;
  }
  const chunkId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const total = Math.ceil(html.length / MAX_CHUNK);
  for (let i = 0; i < total; i++) {
    window.ReactNativeWebView!.postMessage(
      JSON.stringify({
        type: "print_chunk",
        chunkId,
        index: i,
        total,
        title,
        data: html.slice(i * MAX_CHUNK, (i + 1) * MAX_CHUNK),
      }),
    );
  }
}

/**
 * Imprime un rapport de ventes depuis le portail vendeur.
 */
export function printReport(title: string): void {
  const section = document.getElementById("report-print-section");

  if (!section) {
    if (isMobile() && !isNativeWebView()) {
      const safeTitle = title.replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const html =
        `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>` +
        `<title>${safeTitle}</title><style>${REPORT_CSS}</style>` +
        `<script>window.onload=function(){window.focus();window.print();}<\/script></head><body>${document.body.innerHTML}</body></html>`;
      openPrintHtmlWindow(html, title);
    } else {
      window.print();
    }
    return;
  }

  const clone = section.cloneNode(true) as HTMLElement;
  clone.querySelectorAll<HTMLElement>(".no-print").forEach((el) => el.remove());
  clone.querySelectorAll<HTMLElement>(".print-only").forEach((el) => {
    el.style.display = "block";
  });

  const html = buildReportHtml(clone.innerHTML, title, true);

  if (isNativeWebView()) {
    printWithNativeBridge(html, title);
    return;
  }

  openPrintHtmlWindow(html, title);
}
