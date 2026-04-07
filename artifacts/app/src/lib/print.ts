const PRINT_CSS = `
  body { color:#000; background:#fff; font-size:14px; font-family:Helvetica, Arial, sans-serif; margin:0; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  table.voucher { display:inline-block; border:2px solid black; margin:2px; }
  #num { float:right; display:inline-block; }
  @page { size:auto; margin-left:7mm; margin-right:3mm; margin-top:9mm; margin-bottom:3mm; }
  @media print {
    table { page-break-after:auto; }
    tr { page-break-inside:avoid; page-break-after:auto; }
    td { page-break-inside:avoid; page-break-after:auto; }
    thead { display:table-header-group; }
    tfoot { display:table-footer-group; }
  }
`;

/**
 * Imprime des tickets HTML via un <iframe> invisible injecté dans la page.
 * Évite complètement le bloqueur de popups — aucune autorisation navigateur requise.
 */
export function printTickets(htmlItems: string[], title: string): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", title);
  iframe.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:0;visibility:hidden;";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>${PRINT_CSS}</style>
  </head>
  <body>${htmlItems.join("")}</body>
</html>`;

  doc.open();
  doc.write(html);
  doc.close();
  doc.title = title;

  setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      setTimeout(() => {
        try { document.body.removeChild(iframe); } catch (_) {}
      }, 2000);
    }
  }, 400);
}
