/**
 * Feuille de styles Mikhmon v3 pour l’aperçu iframe des tickets (sans logique d’impression).
 * Alignée sur le bloc &lt;style&gt; historique de `voucher/print.php`.
 */
export const MIKHMON_VOUCHER_PRINT_CSS = `
html {
  text-align: left;
}
body {
  color: #000000;
  background-color: #FFFFFF;
  font-family:  'Helvetica', arial, sans-serif;
  margin: 0px;
  text-align: left;
  font-size: 0;
  line-height: 0;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
table.voucher {
  display: inline-block;
  vertical-align: top;
  border: 2px solid black;
  margin: 2px;
  font-size: 14px;
  line-height: normal;
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
  html, body {
    text-align: left !important;
  }
  body, #vn-print-scale-root {
    font-size: 0 !important;
    line-height: 0 !important;
  }
  #vn-print-scale-root {
    text-align: left !important;
  }
  table.voucher {
    font-size: 14px !important;
    line-height: normal !important;
    vertical-align: top !important;
  }
  table { page-break-after:auto }
  tr    { page-break-inside:avoid; page-break-after:auto }
  td    { page-break-inside:avoid; page-break-after:auto }
  thead { display:table-header-group }
  tfoot { display:table-footer-group }
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
