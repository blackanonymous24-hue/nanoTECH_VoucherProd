const PRINT_CSS = `
  body { color:#000; background:#fff; font-size:14px; font-family:Helvetica, Arial, sans-serif; margin:0; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  table.voucher { display:inline-block; border:2px solid black; margin:2px; }
  #num { float:right; display:inline-block; }
  @page { size:auto; margin:0; }
  @media print {
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

function isMobile(): boolean {
  return /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function buildHtml(htmlItems: string[], title: string, autoprint: boolean): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>${PRINT_CSS}</style>
    ${autoprint ? `<script>window.onload=function(){window.focus();window.print();}<\/script>` : ""}
  </head>
  <body>${htmlItems.join("")}</body>
</html>`;
}

function buildReportHtml(bodyHtml: string, title: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>${REPORT_CSS}</style>
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
    document.body.removeChild(iframe);
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();
  doc.title = title;

  setTimeout(() => {
    const prevTitle = document.title;
    document.title = title;
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      setTimeout(() => {
        document.title = prevTitle;
        try { document.body.removeChild(iframe); } catch (_) {}
      }, 2000);
    }
  }, 400);
}

function printWithNewWindow(html: string, title: string): void {
  const win = window.open("", "_blank");
  if (!win) {
    printWithIframe(html, title);
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.document.title = title;
}

/**
 * Imprime des tickets HTML.
 * — Mobile : ouvre un nouvel onglet avec auto-print intégré (les iframes ne
 *   déclenchent pas l'impression sur iOS Safari / Android).
 * — Desktop : utilise un <iframe> invisible (évite le bloqueur de popups).
 */
export function printTickets(htmlItems: string[], title: string): void {
  if (isMobile()) {
    const html = buildHtml(htmlItems, title, true);
    printWithNewWindow(html, title);
  } else {
    const html = buildHtml(htmlItems, title, false);
    printWithIframe(html, title);
  }
}

/**
 * Imprime un rapport de ventes depuis le portail vendeur.
 *
 * Extrait le contenu `.print-only` de `#report-print-section`, supprime les
 * éléments `.no-print`, puis ouvre une nouvelle fenêtre/onglet avec auto-print.
 * Fonctionne dans les WebView Android (APK) où `window.print()` est ignoré.
 *
 * — Mobile / WebView : ouvre un nouvel onglet avec auto-print.
 * — Desktop          : utilise un <iframe> invisible.
 * — Fallback         : si `window.open` est bloqué, tente l'iframe puis
 *                      repasse à `window.print()` natif en dernier recours.
 */
export function printReport(title: string): void {
  const section = document.getElementById("report-print-section");

  if (!section) {
    window.print();
    return;
  }

  const clone = section.cloneNode(true) as HTMLElement;

  // Remove interactive UI elements; keep only the print-only content.
  clone.querySelectorAll<HTMLElement>(".no-print").forEach((el) => el.remove());
  clone.querySelectorAll<HTMLElement>(".print-only").forEach((el) => {
    el.style.display = "block";
  });

  const html = buildReportHtml(clone.innerHTML, title);

  if (isMobile()) {
    printWithNewWindow(html, title);
  } else {
    printWithIframe(html, title);
  }
}
