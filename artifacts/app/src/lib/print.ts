import {
  getActiveVoucherPrintScaleProfile,
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

/** Navigateur mobile ou APK : layout dedie (Safari / WebView gèrent mal zoom sur html). */
function isVoucherPrintMobileLayout(): boolean {
  return isNativeWebView() || isMobile();
}

/**
 * Impression depuis une page HTML complète (rapports vendeur, etc.).
 * APK (React Native WebView) : postMessage → expo-print
 * Navigateur mobile : nouvel onglet + document.write
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

/** Document HTML autonome pour l'impression (suivi vendeurs, hebdo, etc.). */
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

// ── CSS additionnel iOS ────────────────────────────────────────────────────
// Override le @page de MIKHMON_VOUCHER_PRINT_CSS (marges uniformes 5 mm),
// renforce fidélité couleur et non-coupure des tickets.
// Le scale sur body est appliqué par JS (vnIosPrint) pour garantir reflow avant print.
const IOS_PRINT_CSS = `
@page {
  margin: 5mm;
  size: auto;
}
@media print {
  html, body {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .voucher {
    break-inside: avoid;
    page-break-inside: avoid;
  }
}
`;

/**
 * Script iOS inline injecté avant </body>.
 * Appelé depuis body onload="vnIosPrint()".
 *
 * Séquence :
 *   1. Applique transform: scale(zf) + compensation de largeur sur body
 *   2. Attend reflow/repaint (double rAF + setTimeout 50 ms)
 *   3. Lance window.print()
 */
function buildIosPrintScript(zf: number): string {
  const scale = Number(zf.toFixed(6));
  const widthPct = Number((100 / scale).toFixed(4));
  const applyTransform = scale < 1
    ? `var b=document.body;b.style.transformOrigin='top left';b.style.transform='scale(${scale})';b.style.width='${widthPct}%';`
    : ``;
  return `<script>
function vnIosPrint(){
  ${applyTransform}
  function doPrint(){try{window.focus();}catch(_){}window.print();}
  if(typeof requestAnimationFrame==='function'){
    requestAnimationFrame(function(){requestAnimationFrame(function(){setTimeout(doPrint,50);});});
  }else{setTimeout(doPrint,150);}
}
<\/script>`;
}

// ── Document d'impression vouchers ────────────────────────────────────────
// Flux aligné sur mikhmonv3/voucher/print.php.
//
// Profil web / Android : html { zoom: zf } — Chromium/WebKit desktop.
// Profil iOS           : transform: scale(zf) appliqué par JS avant window.print()
//                        (Safari ignore html { zoom } à l'impression).
function buildMikhmonVoucherPrintDocumentHtml(documentTitle: string, bodyTicketsHtml: string): string {
  const safeTitle = documentTitle.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const profile = getActiveVoucherPrintScaleProfile();
  const zoom = getVoucherPrintZoomFactorFromPercent(getVoucherPrintScalePercent());
  const zf = Number(zoom.toFixed(6));

  const isIos = profile === "ios";

  // Web/Android : html { zoom } — ignoré par Safari → géré via JS pour iOS.
  const zoomRule = !isIos && zoom !== 1 ? `html { zoom: ${zf}; }\n` : "";

  const iosCss    = isIos ? IOS_PRINT_CSS : "";
  const iosScript = isIos ? buildIosPrintScript(zf) : "";
  const onload    = isIos ? `vnIosPrint()` : `window.print()`;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta http-equiv="pragma" content="no-cache" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <style>${zoomRule}${MIKHMON_VOUCHER_PRINT_CSS}${iosCss}</style>
  </head>
  <body onload="${onload}">${bodyTicketsHtml}${iosScript}</body>
</html>`;
}

/** Feuille de styles de mikhmonv3/voucher/print.php (bloc style du head). */
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
 * Impression vouchers — un seul flux, aligné sur Mikhmon v3 (voucher/print.php) :
 * window.open + document HTML complet + body onload="window.print()".
 * (WebView native : pont d'impression, seul environnement sans window.open utilisable.)
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

/** Imprime un rapport de ventes depuis le portail vendeur. */
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
