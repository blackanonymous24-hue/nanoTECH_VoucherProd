const TICKET_CSS = `
  table.voucher { display:inline-block; border:2px solid black; margin:2px; }
  #num { float:right; display:inline-block; }
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
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
 * L'iframe reçoit un document HTML complet, ce qui garantit un rendu correct.
 * document.title de la page principale est changé temporairement pour
 * que Edge/Chrome/Firefox utilisent le bon nom de fichier.
 */
export function printTickets(htmlItems: string[], title: string): void {
  const iframe = document.createElement("iframe");
  iframe.style.cssText =
    "position:fixed;top:-9999px;left:-9999px;width:1024px;height:768px;border:0;opacity:0;pointer-events:none;";
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
    <style>
      body {
        color: #000;
        background: #fff;
        font-size: 14px;
        font-family: Helvetica, Arial, sans-serif;
        margin: 0;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      ${TICKET_CSS}
    </style>
  </head>
  <body>${htmlItems.join("")}</body>
</html>`;

  doc.open();
  doc.write(html);
  doc.close();

  // Changer le titre de la fenêtre principale — utilisé par tous les navigateurs
  // comme nom de fichier dans la boîte "Enregistrer en PDF"
  const prevTitle = document.title;
  document.title = title;

  setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      // Restaurer le titre et nettoyer l'iframe après que la boîte s'est ouverte
      setTimeout(() => {
        document.title = prevTitle;
        try { document.body.removeChild(iframe); } catch (_) {}
      }, 3000);
    }
  }, 500);
}
