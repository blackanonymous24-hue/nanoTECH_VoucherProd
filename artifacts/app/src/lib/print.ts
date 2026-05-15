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

/** iOS Safari (inclut iPadOS 13+) — `zoom` CSS n'affecte pas le layout flex sur cette plateforme. */
function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) return true;
  // iPadOS 13+ se signale comme Macintosh mais a le multi-touch
  return navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent);
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
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
}
html.vn-print-mobile table.voucher {
  flex: 0 0 auto;
  display: inline-block !important;
  vertical-align: top !important;
  box-sizing: border-box !important;
  margin: 1mm !important;
}
`;
}

/**
 * Extrait les éléments `<table class="voucher">...</table>` individuels depuis le HTML
 * concaténé des tickets. Gère l'imbrication de tables (template mikhmon-small en a 3 niveaux).
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
      const closeEnd = nextClose + 8; // '</table>' = 8 chars
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
 * Document d’impression vouchers — même principe que `mikhmonv3/voucher/print.php` :
 * nouvel onglet, HTML complet, `&lt;body onload="window.print()"&gt;` (pas d’iframe, pas d’autre déclencheur).
 */
function buildMikhmonVoucherPrintDocumentHtml(documentTitle: string, bodyTicketsHtml: string): string {
  const safeTitle = documentTitle.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const mobile = isVoucherPrintMobileLayout();
  const ios = isIOS();
  const zoom = getVoucherPrintZoomFactorFromPercent(getVoucherPrintScalePercent());
  const zf = Number(zoom.toFixed(6));

  // Desktop : `html { zoom }` — bien pris en charge par Chromium.
  const zoomRuleDesktop = !mobile && zoom !== 1 ? `html { zoom: ${zf}; }\n` : "";

  // ── Mobile print scaling ──────────────────────────────────────────────────
  //
  // ANDROID (Chromium) : `zoom: zf` sur le flex container `#vn-print-scale-root`
  //   avec `width: A4_PX/zf` → le flex remplit DYNAMIQUEMENT (browser décide N cols),
  //   visuel = A4_PX, scaling correct. C'est l'approche confirmée « parfaite ».
  //
  // iOS (Safari/Chrome) : zoom sur flex container casse tout (cascade interne sur
  //   Safari + colonnes mal calculées sur Chrome iOS + break-inside: avoid ignoré).
  //   → On utilise des RANGÉES HTML pré-calculées : chaque rangée = <div bloc>
  //   avec zoom: zf et break-inside: avoid. Le flex INTERNE de la rangée respecte
  //   le coordinate system natif. break-inside: avoid sur un bloc fonctionne.
  //
  //  A4_PX      = 206 mm (A4 − marges 2 mm×2) × 96 dpi ÷ 25,4 = 779 px CSS
  //  gridWidthPx = A4_PX / zf  (largeur logique du conteneur ou des rangées)
  const A4_PX = Math.round((206 / 25.4) * 96); // 779 px
  const TICKET_W_PX = 160;
  const TICKET_MARGIN_PX = Math.round((2 / 25.4) * 96); // ≈ 8 px (1 mm × 2 côtés)
  const TICKET_EFFECTIVE_W = TICKET_W_PX + TICKET_MARGIN_PX; // ≈ 168 px
  const gridWidthPx = mobile && zoom !== 1 ? Math.round(A4_PX / zf) : A4_PX;

  // ── Découpage en rangées : iOS uniquement (Android se débrouille avec flex) ──
  let processedBodyHtml = bodyTicketsHtml;
  if (mobile && ios) {
    const numCols = Math.max(1, Math.floor(gridWidthPx / TICKET_EFFECTIVE_W));
    const ticketsList = splitVoucherTickets(bodyTicketsHtml);
    const rowsHtml: string[] = [];
    for (let ri = 0; ri < ticketsList.length; ri += numCols) {
      rowsHtml.push(
        `<div class="vn-ticket-row">${ticketsList.slice(ri, ri + numCols).join("")}</div>`,
      );
    }
    processedBodyHtml = rowsHtml.join("");
  }

  // ── CSS impression : branche iOS vs Android ──────────────────────────────
  let mobileScaleCss = "";
  if (mobile && ios) {
    // iOS : rangées-blocs avec zoom + break-inside: avoid
    mobileScaleCss =
      `@media print {\n` +
      `  html.vn-print-mobile body {\n` +
      `    width: ${A4_PX}px !important;\n` +
      `    max-width: none !important;\n` +
      `    overflow-x: hidden !important;\n` +
      `    overflow-y: visible !important;\n` +
      `  }\n` +
      `  html.vn-print-mobile #vn-print-scale-root {\n` +
      `    display: block !important;\n` +
      `    width: ${A4_PX}px !important;\n` +
      `    max-width: none !important;\n` +
      `  }\n` +
      `  html.vn-print-mobile .vn-ticket-row {\n` +
      `    display: flex !important;\n` +
      `    flex-wrap: nowrap !important;\n` +
      `    align-items: flex-start !important;\n` +
      `    width: ${gridWidthPx}px !important;\n` +
      `    max-width: none !important;\n` +
      (zoom !== 1 ? `    zoom: ${zf} !important;\n` : ``) +
      `    break-inside: avoid !important;\n` +
      `    page-break-inside: avoid !important;\n` +
      `  }\n` +
      `}\n`;
  } else if (mobile) {
    // Android : zoom sur le flex container — remplissage libre par le moteur flex
    mobileScaleCss =
      `@media print {\n` +
      `  html.vn-print-mobile body {\n` +
      `    width: ${A4_PX}px !important;\n` +
      `    max-width: none !important;\n` +
      `    overflow-x: hidden !important;\n` +
      `    overflow-y: visible !important;\n` +
      `  }\n` +
      `  html.vn-print-mobile #vn-print-scale-root {\n` +
      `    display: flex !important;\n` +
      `    flex-wrap: wrap !important;\n` +
      `    width: ${gridWidthPx}px !important;\n` +
      `    max-width: none !important;\n` +
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
