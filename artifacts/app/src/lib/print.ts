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
 * Imprime des tickets HTML en injectant une zone d'impression dans la page principale
 * et en appelant window.print(). Compatible Chrome, Edge, Firefox, Safari.
 * Le titre document.title est utilisé comme nom de fichier par tous les navigateurs.
 */
export function printTickets(htmlItems: string[], title: string): void {
  const uid = `vn-print-${Date.now()}`;

  // Zone de contenu à imprimer (cachée à l'écran)
  const printDiv = document.createElement("div");
  printDiv.id = uid;
  printDiv.innerHTML = htmlItems.join("");

  // Style : masquer tout sauf la zone d'impression lors de l'impression
  const styleTag = document.createElement("style");
  styleTag.setAttribute("data-print-uid", uid);
  styleTag.textContent = `
    @media screen { #${uid} { display:none; } }
    @media print {
      body > *:not(#${uid}) { display:none !important; visibility:hidden !important; }
      #${uid} { display:block !important; visibility:visible !important; }
      ${PRINT_CSS}
    }
  `;

  document.head.appendChild(styleTag);
  document.body.appendChild(printDiv);

  const prevTitle = document.title;
  document.title = title;

  // Laisser le DOM se mettre à jour avant d'imprimer
  setTimeout(() => {
    window.print();

    // Nettoyer après impression (délai pour laisser la boîte s'ouvrir)
    setTimeout(() => {
      document.title = prevTitle;
      try { document.head.removeChild(styleTag); } catch (_) {}
      try { document.body.removeChild(printDiv); } catch (_) {}
    }, 1500);
  }, 100);
}
