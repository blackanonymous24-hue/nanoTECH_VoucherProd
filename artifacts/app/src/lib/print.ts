import {
  getVoucherPrintScalePercent,
  getVoucherPrintZoomFactorFromPercent,
  getCurrentPrintTemplateId,
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

function writeHtmlToPrintWindow(win: Window, html: string, title: string): void {
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

function buildPrintLoadingHtml(title: string): string {
  const safeTitle = title.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${safeTitle}</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;color:#334155}
.box{text-align:center;padding:2rem}</style></head>
<body><div class="box"><p style="font-size:1rem;margin:0">Préparation de l'impression…</p>
<p style="font-size:0.85rem;color:#64748b;margin:0.75rem 0 0">Ne fermez pas cette fenêtre.</p></div></body></html>`;
}

export type VoucherPrintSlot =
  | { kind: "native" }
  | { kind: "window"; win: Window }
  | { kind: "blocked" };

/** Ouvre la fenêtre d'impression au clic (synchrone) pour éviter le blocage des popups. */
export function acquireVoucherPrintWindow(documentTitle: string): VoucherPrintSlot {
  if (isNativeWebView()) return { kind: "native" };
  const win = window.open("", "_blank");
  if (!win) return { kind: "blocked" };
  writeHtmlToPrintWindow(win, buildPrintLoadingHtml(documentTitle), documentTitle);
  return { kind: "window", win };
}

export function commitVoucherPrint(
  slot: VoucherPrintSlot,
  bodyTicketsHtml: string,
  documentTitle: string,
): void {
  const html = buildMikhmonVoucherPrintDocumentHtml(documentTitle, bodyTicketsHtml);
  if (slot.kind === "native") {
    printWithNativeBridge(html, documentTitle);
    return;
  }
  if (slot.kind === "window" && !slot.win.closed) {
    writeHtmlToPrintWindow(slot.win, html, documentTitle);
  }
}

export function abortVoucherPrint(slot: VoucherPrintSlot): void {
  if (slot.kind === "window" && !slot.win.closed) {
    try {
      slot.win.close();
    } catch {
      /* ignore */
    }
  }
}

/** @returns false si le navigateur a bloqué la fenêtre contextuelle */
export function openPrintHtmlWindow(html: string, title: string): boolean {
  if (isNativeWebView()) {
    printWithNativeBridge(html, title);
    return true;
  }
  const win = window.open("", "_blank");
  if (!win) return false;
  writeHtmlToPrintWindow(win, html, title);
  return true;
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
 * Document d’impression vouchers — flux pur et identique à `mikhmonv3/voucher/print.php`
 * pour TOUS les appareils (desktop + mobile) :
 *   - nouvel onglet, HTML complet
 *   - `<body onload="window.print()">` (pas d'iframe, pas d'autre déclencheur)
 *   - aucun CSS mobile additionnel, aucun wrap en rangées, aucun script de mesure
 *
 * Seule règle additionnelle : `html { zoom }` desktop si l'utilisateur a réglé
 * le sélecteur d'échelle ≠ 100 %. Sur mobile : aucune règle d'échelle (le navigateur
 * applique son rendu naturel d'impression mikhmonv3).
 */
function buildMikhmonVoucherPrintDocumentHtml(documentTitle: string, bodyTicketsHtml: string): string {
  const safeTitle = documentTitle.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const mobile = isVoucherPrintMobileLayout();
  const zoom = getVoucherPrintZoomFactorFromPercent(getVoucherPrintScalePercent(getCurrentPrintTemplateId()));
  const zf = Number(zoom.toFixed(6));

  // Desktop uniquement : `html { zoom }` (bien pris en charge par Chromium).
  // Mobile : aucune règle d'échelle — flux mikhmonv3 brut.
  const zoomRule = !mobile && zoom !== 1 ? `html { zoom: ${zf}; }\n` : "";

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta http-equiv="pragma" content="no-cache" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <style>${zoomRule}${MIKHMON_VOUCHER_PRINT_CSS}</style>
  </head>
  <body onload="window.print()">${bodyTicketsHtml}</body>
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
/** Impression synchrone (HTML déjà prêt). Préférer acquire + commit si des fetch précèdent. */
export function printMikhmonSmallVouchers(bodyTicketsHtml: string, documentTitle: string): void {
  const slot = acquireVoucherPrintWindow(documentTitle);
  if (slot.kind === "blocked") return;
  commitVoucherPrint(slot, bodyTicketsHtml, documentTitle);
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
