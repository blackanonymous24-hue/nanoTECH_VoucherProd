/**
 * Vérifie le contrat HTML/CSS de l’échelle d’impression (navigateur + wrapper APK).
 * Exécution : `npm run test:print-scale` depuis artifacts/app (ou `npx tsx scripts/verify-print-scale.ts`).
 */
import assert from "node:assert/strict";
import {
  buildVoucherPrintZoomCssForHead,
  buildVoucherPrintZoomHtmlRootAttrs,
  wrapVoucherTicketsForExpoPrintScale,
  buildMikhmonVoucherPrintStylePayload,
  buildStandalonePrintHtml,
  MIKHMON_VOUCHER_PRINT_CSS,
} from "../src/lib/print";

function main(): void {
  assert.equal(buildVoucherPrintZoomCssForHead(100), "");
  assert.equal(buildVoucherPrintZoomHtmlRootAttrs(100), undefined);
  const p100 = buildMikhmonVoucherPrintStylePayload(100);
  assert.equal(p100.styleCss.trim(), MIKHMON_VOUCHER_PRINT_CSS.trim());
  assert.equal(p100.htmlAttrs, undefined);

  const css85 = buildVoucherPrintZoomCssForHead(85);
  assert.ok(css85.includes("@media print"));
  assert.match(css85, /zoom:\s*0\.85/);
  assert.ok(css85.includes("-webkit-text-size-adjust"));

  const root85 = buildVoucherPrintZoomHtmlRootAttrs(85);
  assert.ok(root85?.includes('style="'));
  assert.match(root85 ?? "", /zoom:0\.85/);

  const { styleCss, htmlAttrs } = buildMikhmonVoucherPrintStylePayload(80);
  const doc = buildStandalonePrintHtml("Titre test", styleCss, "<p>x</p>", { autoprint: false, htmlAttrs });
  assert.ok(doc.includes("shrink-to-fit=no"));
  assert.match(doc, /<html style="[^"]*zoom:0\.8/);
  assert.ok(doc.includes("<p>x</p>"));

  const inner = '<table class="voucher"></table>';
  const wrapped = wrapVoucherTicketsForExpoPrintScale(inner, 80);
  assert.ok(wrapped.includes('id="vn-expo-print-scale"'));
  assert.ok(wrapped.includes("transform:scale(0.800000)"));
  assert.ok(wrapped.includes("-webkit-transform:scale(0.800000)"));
  assert.ok(wrapped.includes("width:125.000000%"));
  assert.ok(wrapped.includes(inner));
  assert.equal(wrapVoucherTicketsForExpoPrintScale("a", 100), "a");

  console.log("verify-print-scale: OK (contrat HTML/CSS échelle impression)");
}

main();
