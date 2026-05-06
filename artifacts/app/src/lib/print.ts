/* @page DOIT être au niveau racine — imbriqué dans @media print = CSS invalide ignoré par Safari */
const PRINT_PAGE_CSS = `
  @page         { margin:4mm 0 0 0; }
  @page :first  { margin:4mm 0 0 0; }
  @page :left   { margin:4mm 0 0 0; }
  @page :right  { margin:4mm 0 0 0; }
`;

const PRINT_CSS = `
  body { color:#000; background:#fff; font-size:14px; font-family:Helvetica, Arial, sans-serif; margin:0; padding:0; padding-bottom:env(safe-area-inset-bottom,0); -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  table.voucher { display:inline-block; margin:0; }
  .doc-header { display:none !important; }
  /* Grille 4 colonnes — chaque .ticket-page = 1 page imprimée (32 tickets max) */
  table.ticket-page { border-collapse:collapse; margin-bottom:2px; }
  /* > tbody > tr > td : cible uniquement les td directs du wrapper, pas les td internes du ticket */
  table.ticket-page > tbody > tr > td { padding:1px; vertical-align:top; }
  @media screen {
    body { padding-bottom:100px; }
  }
  @media print {
    body { padding:3mm 1mm 1mm !important; }
    /* inline-table + div wrapper text-align:center = centrage sans flex (flex casse break-inside) */
    .ticket-page-wrap { display:block; text-align:center; }
    table.ticket-page { display:inline-table; margin:0; }
    /* Empêche une rangée de 4 tickets d'être coupée entre deux pages */
    table.ticket-page tr { page-break-inside:avoid; break-inside:avoid; }
    /* Empêche chaque ticket individuel d'être coupé */
    table.ticket-page td > table,
    table.ticket-page td > table * { page-break-inside:avoid; break-inside:avoid; }
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
 * Impression depuis une page HTML complète (comme « Imprimer Hebdo » : write + print).
 * — APK (React Native WebView) : envoi au natif → expo-print (`Print.printAsync`) — `window.open` est souvent bloqué.
 * — Navigateur mobile : nouvel onglet + document.write.
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
  } catch (_) {
    /* ignore */
  }
}

/**
 * Construit le HTML complet pour l'impression de tickets (avec autoprint).
 * Exposé pour permettre la pré-ouverture de fenêtre avant tout `await`.
 */
export function buildTicketPrintHtml(htmlItems: string[], title: string, scale = 85): string {
  return buildHtml(htmlItems, title, true, scale);
}

function buildHtml(htmlItems: string[], title: string, autoprint: boolean, scale = 85): string {
  // Groupe les tickets en pages de 4 colonnes × 8 lignes = 32 par page
  const COLS = 4;
  const ROWS = 8;
  const PER_PAGE = COLS * ROWS;

  const pageBlocks: string[] = [];
  for (let p = 0; p < htmlItems.length; p += PER_PAGE) {
    const page = htmlItems.slice(p, p + PER_PAGE);
    const rows: string[] = [];
    for (let r = 0; r < page.length; r += COLS) {
      const cells = page.slice(r, r + COLS)
        .map(item => `<td style="padding:2px;vertical-align:top;">${item}</td>`)
        .join("");
      rows.push(`<tr>${cells}</tr>`);
    }
    pageBlocks.push(`<div class="ticket-page-wrap"><table class="ticket-page"><tbody>${rows.join("")}</tbody></table></div>`);
  }

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${title}</title>
    <style>${PRINT_PAGE_CSS}</style>
    <style>${PRINT_CSS}</style>
    <style>@media print { body { zoom:${scale / 100}; } }</style>
    ${autoprint ? `<script>window.onload=function(){setTimeout(function(){window.focus();window.print();},500);}<\/script>` : ""}
  </head>
  <body>${pageBlocks.join("")}</body>
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
  }, 600);
}

/**
 * Envoie le HTML au pont natif React Native WebView pour impression via
 * le dialogue Android/iOS natif (expo-print).
 * Pour les gros payloads (> 500 KB), découpe en chunks pour contourner la
 * limite de taille de postMessage sur Android WebView.
 */
function printWithNativeBridge(html: string, title: string): void {
  const MAX_CHUNK = 500_000; // 500 KB de HTML par message
  if (html.length <= MAX_CHUNK) {
    window.ReactNativeWebView!.postMessage(
      JSON.stringify({ type: "print", html, title })
    );
    return;
  }
  // Payload trop grand : envoi découpé en chunks
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
      })
    );
  }
}

/**
 * Imprime des tickets HTML.
 * — APK WebView : pont natif via postMessage → expo-print.
 * — Mobile web  : nouvel onglet + document.write (comme « Imprimer Hebdo »).
 * — Desktop     : utilise un <iframe> invisible.
 */
export function printTickets(htmlItems: string[], title: string, scale = 85): void {
  let html = buildHtml(htmlItems, title, false, scale);

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
