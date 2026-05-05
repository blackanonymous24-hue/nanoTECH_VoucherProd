const PRINT_CSS = `
  body { color:#000; background:#fff; font-size:14px; font-family:Helvetica, Arial, sans-serif; margin:0; padding:0; padding-bottom:env(safe-area-inset-bottom,0); -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  table.voucher { display:inline-block; border:2px solid black; margin:2px; }
  #num { float:right; display:inline-block; }
  .doc-header { display:none; }
  @page { size:auto; margin:4mm; }
  @media screen {
    body { padding-bottom: 100px; }
  }
  @media print {
    body { padding-bottom:0 !important; padding-top:8mm !important; }
    .doc-header {
      display:block;
      position:fixed;
      top:0; left:0; right:0;
      font-size:8px;
      font-weight:bold;
      font-family:Arial, Helvetica, sans-serif;
      text-align:center;
      padding:1mm 4mm 1.5mm;
      border-bottom:1px solid #555;
      background:#fff;
      z-index:9999;
      letter-spacing:0.03em;
    }
    /* Un ticket par page en multi-impression (Safari iOS regroupait tout sur une page). */
    body > table { display:table; page-break-inside:avoid; break-inside:avoid; max-width:100%; }
    body > table + table { page-break-before:always; break-before:page; }
    table { page-break-after:auto; }
    tr { page-break-inside:avoid; page-break-after:auto; }
    td { page-break-inside:avoid; page-break-after:auto; }
    thead { display:table-header-group; }
    tfoot { display:table-footer-group; }
  }
`;

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
  return /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function normalizeSessionName(raw: string): string {
  const normalized = raw
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return normalized || "WIFI_SESSION";
}

function buildVoucherPrintUrl(voucherId: string, sessionName: string): string | null {
  const base = typeof window !== "undefined" ? window.location.origin.replace(/\/$/, "") : "";
  if (!base) return null;
  return `${base}/voucher/print.php?id=${encodeURIComponent(voucherId)}&small=yes&session=${encodeURIComponent(sessionName)}`;
}

/**
 * Mobile flow for Mikhmon print page:
 * open /voucher/print.php?id=...&small=yes&session=...
 * Returns true when URL flow is used; false means fallback to HTML printing.
 */
export async function tryOpenVoucherPrintPage(_voucherId: string, _hotspotOrSessionName: string): Promise<boolean> {
  // This app does not host a Mikhmon print.php server.
  // The SPA Vite fallback always returns HTTP 200 for any URL, which would fool a
  // HEAD probe and trigger an unwanted navigation. All printing goes through the
  // HTML bridge (postMessage on native WebView, window.open on mobile browsers,
  // hidden iframe on desktop).
  return false;
}

/**
 * Impression depuis une page HTML complète.
 * — APK (React Native WebView) : envoi au natif → expo-print.
 * — Navigateur mobile/desktop : Blob URL → window.open (évite document.write
 *   qui bloque le thread UI sur les gros documents, et contourne le blocage
 *   popup lié aux appels async).
 */
export function openPrintHtmlWindow(html: string, title: string): void {
  if (isNativeWebView()) {
    printWithNativeBridge(html, title);
    return;
  }

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  // Revoke after 5 min — enough time for the print dialog to load
  setTimeout(() => URL.revokeObjectURL(url), 300_000);

  const win = window.open(url, "_blank");
  if (!win) {
    // Popup blocked: create a temporary <a> and click it
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}

function buildHtml(htmlItems: string[], title: string, autoprint: boolean): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${title}</title>
    <style>${PRINT_CSS}</style>
    ${autoprint ? `<script>window.onload=function(){window.focus();window.print();}<\/script>` : ""}
  </head>
  <body><div class="doc-header">${title}</div>${htmlItems.join("")}</body>
</html>`;
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
 * Document HTML autonome pour l’impression (suivi vendeurs, hebdo, etc.) :
 * même en-tête viewport + onload que les rapports, pour Safari iOS / WebView.
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

function printWithIframe(html: string, title: string): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", title);
  iframe.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:0;visibility:hidden;";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  if (!doc) {
    try { document.body.removeChild(iframe); } catch (_) {}
    throw new Error("iframe document indisponible");
  }

  doc.open();
  doc.write(html);
  doc.close();
  doc.title = title;

  const cleanup = () => {
    try { document.body.removeChild(iframe); } catch (_) {}
  };
  iframe.contentWindow?.addEventListener("afterprint", cleanup, { once: true });
  const safetyTimeout = window.setTimeout(cleanup, 60_000);

  // Scale delay with document size: large HTML (many vouchers) needs more time
  // to render before window.print() fires — otherwise the dialog opens blank.
  const byteSize = html.length;
  const printDelay = byteSize > 5_000_000 ? 4000 : byteSize > 1_000_000 ? 2000 : 800;

  setTimeout(() => {
    const prevTitle = document.title;
    document.title = title;
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch (_) {
      window.clearTimeout(safetyTimeout);
      cleanup();
      document.title = prevTitle;
      throw _;
    }
    document.title = prevTitle;
  }, printDelay);
}

/**
 * Envoie le HTML au pont natif React Native WebView pour impression via
 * le dialogue Android/iOS natif (expo-print).
 */
function printWithNativeBridge(html: string, title: string): void {
  window.ReactNativeWebView!.postMessage(
    JSON.stringify({ type: "print", html, title })
  );
}

/**
 * Imprime des tickets HTML.
 * — APK WebView : pont natif via postMessage → expo-print.
 * — Mobile web  : nouvel onglet + document.write (comme « Imprimer Hebdo »).
 * — Desktop     : utilise un <iframe> invisible.
 */
export function printTickets(htmlItems: string[], title: string): void {
  let html = buildHtml(htmlItems, title, false);

  if (isNativeWebView()) {
    printWithNativeBridge(html, title);
    return;
  }

  if (isMobile()) {
    if (!/<script[^>]*>[\s\S]*window\.print\s*\(/i.test(html)) {
      html = html.replace(/<\/body>/i, `<script>window.onload=function(){window.print();}<\/script></body>`);
    }
    openPrintHtmlWindow(html, title);
  } else {
    printWithIframe(html, title);
  }
}

/**
 * Imprime un rapport de ventes depuis le portail vendeur.
 * — APK WebView : pont natif via postMessage → expo-print.
 * — Mobile web  : nouvel onglet + document.write (comme « Imprimer Hebdo »).
 * — Desktop     : utilise un <iframe> invisible.
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

  if (isMobile()) {
    openPrintHtmlWindow(html, title);
  } else {
    printWithIframe(html, title);
  }
}
