const PRINT_CSS = `
  body { color:#000; background:#fff; font-size:14px; font-family:Helvetica, Arial, sans-serif; margin:0; padding:0; padding-bottom:env(safe-area-inset-bottom,0); -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  table.voucher { display:inline-block; border:2px solid black; margin:2px; }
  #num { float:right; display:inline-block; }
  @page { size:auto; margin:4mm; }
  @media screen {
    body { padding-bottom: 100px; }
  }
  @media print {
    #__nt_ios_print_bar { display:none !important; }
    body { padding-bottom:0 !important; }
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

/** Détection iOS / iPadOS (comportement impression navigateur différent d’Android). */
function isIOS(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/** Barre tactile iOS : Safari bloque souvent print() sans geste utilisateur ; le bouton déclenche la feuille native. */
function injectIosPrintBar(html: string): string {
  const bar =
    `<div id="__nt_ios_print_bar" style="position:fixed;bottom:0;left:0;right:0;z-index:2147483647;` +
    `background:#0f172a;color:#f8fafc;padding:12px 14px calc(12px + env(safe-area-inset-bottom,0));` +
    `font-family:system-ui,-apple-system,sans-serif;font-size:14px;box-shadow:0 -4px 24px rgba(0,0,0,.35);` +
    `display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:center;text-align:center;">` +
    `<span style="flex:1 1 220px;line-height:1.35">` +
    `Impression : touchez <strong>Imprimer</strong> ci-dessous (iOS peut refuser l’ouverture automatique du dialogue).` +
    `</span>` +
    `<button type="button" onclick="window.print()" style="padding:11px 20px;border-radius:10px;border:none;font-weight:600;` +
    `background:#2563eb;color:#fff;-webkit-tap-highlight-color:transparent;cursor:pointer">Imprimer</button>` +
    `<button type="button" onclick="this.parentElement.style.display='none'" style="padding:9px 14px;border-radius:10px;` +
    `border:1px solid #475569;background:transparent;color:#cbd5e1;font-size:13px;cursor:pointer">Masquer</button>` +
    `</div>`;
  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body([^>]*)>/i, `<body$1>${bar}`);
  }
  return html;
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
  <body>${htmlItems.join("")}</body>
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
 * Ouvre le HTML dans un nouvel onglet via une Blob URL.
 * Android : print() au chargement. iOS : tentative différée + barre « Imprimer »
 * (Safari exige souvent un tap explicite pour ouvrir la feuille d’impression).
 */
function printForMobileWeb(html: string, title: string): void {
  const ios = isIOS();
  let doc = ios ? injectIosPrintBar(html) : html;
  const printScript = ios
    ? `<script>(function(){
  function run(){try{window.focus();window.print();}catch(_){}}
  if(document.readyState==="complete")setTimeout(run,450);
  else window.addEventListener("load",function(){setTimeout(run,450);},{once:true});
})();<\/script></head>`
    : `<script>window.onload=function(){window.focus();window.print();}<\/script></head>`;
  const fullHtml = doc.replace(/<\/head>/i, printScript);

  try {
    const blob = new Blob([fullHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank");
    if (win) {
      setTimeout(() => URL.revokeObjectURL(url), 120_000);
      return;
    }
    URL.revokeObjectURL(url);
  } catch (_) { /* chute vers fallback */ }

  // Fallback : écriture directe dans une nouvelle fenêtre
  let win: Window | null = null;
  try { win = window.open("", "_blank"); } catch (_) { win = null; }
  if (win) {
    win.document.open();
    win.document.write(fullHtml);
    win.document.close();
    win.document.title = title;
  }
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
 * — Mobile web  : nouvel onglet Blob (iOS Partager→Imprimer / Android auto-print).
 * — Desktop     : utilise un <iframe> invisible.
 */
export function printTickets(htmlItems: string[], title: string): void {
  const html = buildHtml(htmlItems, title, false);

  if (isNativeWebView()) {
    printWithNativeBridge(html, title);
    return;
  }

  if (isMobile()) {
    printForMobileWeb(html, title);
  } else {
    printWithIframe(html, title);
  }
}

/**
 * Imprime un rapport de ventes depuis le portail vendeur.
 * — APK WebView : pont natif via postMessage → expo-print.
 * — Mobile web  : nouvel onglet Blob (iOS Partager→Imprimer / Android auto-print).
 * — Desktop     : utilise un <iframe> invisible.
 */
export function printReport(title: string): void {
  const section = document.getElementById("report-print-section");

  if (!section) {
    if (isMobile() && !isNativeWebView()) {
      printForMobileWeb(`<!doctype html><html><head><meta charset="utf-8"/><style>${REPORT_CSS}</style></head><body>${document.body.innerHTML}</body></html>`, title);
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

  const html = buildReportHtml(clone.innerHTML, title, !isIOS());

  if (isNativeWebView()) {
    printWithNativeBridge(html, title);
    return;
  }

  if (isMobile()) {
    printForMobileWeb(html, title);
  } else {
    printWithIframe(html, title);
  }
}
