import {
  getVoucherPrintScaleDesktop,
  getVoucherPrintScaleMobile,
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

/**
 * Onglet mobile ouvert au clic (avant les fetch) : page blanche comme l’attente sur
 * `mikhmonv3/voucher/print.php`, sans UI supplémentaire.
 */
const VOUCHER_PRINT_BLANK_PRELOAD_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Impression</title>
<style>html,body{height:100%;margin:0;background:#fff}</style>
</head><body></body></html>`;

/**
 * Page de chargement **uniquement** lorsque l’impression diffère du flux MikHmon par défaut
 * (ici : mise à l’échelle mobile ≠ 100 % — le document final applique `zoom`, préparation plus longue).
 */
const VOUCHER_PRINT_LOADING_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Chargement…</title>
<style>
  body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;
    background:#f8f9fa;font-family:system-ui,sans-serif;flex-direction:column;gap:20px;color:#444}
  .spinner{width:56px;height:56px;border:5px solid #e0e0e0;border-top-color:#7c3aed;
    border-radius:50%;animation:spin 0.9s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  p{font-size:1.05rem;text-align:center;max-width:280px;line-height:1.5;margin:0}
</style></head>
<body><div class="spinner"></div>
<p>Les tickets vont s'afficher dans un instant,<br>veuillez patienter…</p>
</body></html>`;

/**
 * Flux aligné sur MikHmon `print.php` : **pas** d’onglet intermédiaire sur desktop
 * (l’impression passe par un iframe, comme une fenêtre d’impression sans page « chargement »).
 * Sur **mobile**, ouverture au geste utilisateur avant les requêtes async : document blanc minimal ;
 * page avec spinner seulement si la mise à l’échelle mobile ≠ 1 (paramètre hors flux d’origine).
 */
export function openVoucherPrintPreparationWindow(): Window | null {
  if (isNativeWebView()) return null;
  /** Desktop : même logique que print.php ouvert depuis le navigateur — pas de pré-onglet. */
  if (!isMobileUserAgent()) return null;
  const w = window.open("", "_blank");
  if (!w) return null;
  const preloadHtml =
    getVoucherPrintScaleMobile() !== 1 ? VOUCHER_PRINT_LOADING_HTML : VOUCHER_PRINT_BLANK_PRELOAD_HTML;
  try {
    w.document.write(preloadHtml);
    w.document.close();
  } catch {
    try {
      w.close();
    } catch {
      /* ignore */
    }
    return null;
  }
  return w;
}

export function isMobileUserAgent(): boolean {
  if (/Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)) return true;
  if (typeof navigator !== "undefined" && navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent)) return true;
  return false;
}

/**
 * Impression depuis une page HTML complète (rapports vendeur, etc.).
 * — APK (React Native WebView) : postMessage → expo-print
 * — Navigateur mobile : nouvel onglet + document.write
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
  } catch {
    /* ignore */
  }
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
export type BuildStandalonePrintHtmlOptions = {
  /**
   * Facteur d’échelle « page entière », comme le réglage **Mise à l’échelle** du dialogue
   * d’impression des navigateurs (Chrome, Edge, Safari) : propriété CSS `zoom` sur `html`.
   */
  printScale?: number;
  /**
   * Comme `print.php` Mikhmon : meta viewport simple, sans `viewport-fit` (ajout hors flux d’origine).
   */
  mikhmonCompatibleViewport?: boolean;
};

export function buildStandalonePrintHtml(
  title: string,
  styleCss: string,
  bodyHtml: string,
  options?: BuildStandalonePrintHtmlOptions,
): string {
  const safeTitle = title.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const raw = options?.printScale;
  const scale =
    raw != null && Number.isFinite(raw) && raw > 0 ? Math.min(1.25, Math.max(0.5, raw)) : 1;
  /** Même effet visuel que la mise à l’échelle du dialogue d’impression (zoom document). */
  const scaleCss =
    scale !== 1
      ? `
  html {
    zoom: ${scale};
  }
`
      : "";
  const viewportContent = options?.mikhmonCompatibleViewport
    ? "width=device-width, initial-scale=1"
    : "width=device-width, initial-scale=1, viewport-fit=cover";
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="${viewportContent}" />
    <title>${safeTitle}</title>
    <style>${styleCss}${scaleCss}</style>
    <script>window.onload=function(){window.focus();window.print();}<\/script>
  </head>
  <body>${bodyHtml}</body>
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
 * HTML complet du document d’impression vouchers (Mikhmon small + zoom tenant).
 */
export function buildMikhmonSmallVouchersPrintHtml(bodyTicketsHtml: string, documentTitle: string): string {
  const printScale = isMobileUserAgent()
    ? getVoucherPrintScaleMobile()
    : getVoucherPrintScaleDesktop();
  return buildStandalonePrintHtml(documentTitle, MIKHMON_VOUCHER_PRINT_CSS, bodyTicketsHtml, {
    printScale,
    mikhmonCompatibleViewport: true,
  });
}

function dispatchVoucherPrintHtml(html: string, documentTitle: string, preOpenedWindow: Window | null | undefined): void {
  const w = preOpenedWindow;
  if (w && !w.closed) {
    try {
      w.document.open();
      w.document.write(html);
      w.document.close();
    } catch {
      try {
        w.close();
      } catch {
        /* ignore */
      }
      dispatchVoucherPrintHtml(html, documentTitle, null);
      return;
    }
    try {
      w.document.title = documentTitle;
      const te = w.document.querySelector("title");
      if (te) te.textContent = documentTitle;
    } catch {
      /* ignore */
    }
    return;
  }

  if (isNativeWebView()) {
    printWithNativeBridge(html, documentTitle);
    return;
  }

  if (isMobileUserAgent()) {
    openPrintHtmlWindow(html, documentTitle);
  } else {
    printWithIframe(html, documentTitle);
  }
}

/**
 * Impression navigateur / WebView mobile / APK — même stratégie que les rapports,
 * avec le document Mikhmon « small » (print.php + template-small).
 *
 * @param preOpenedWindow Sur **mobile**, onglet ouvert au clic avec {@link openVoucherPrintPreparationWindow}
 *                        (évite le blocage popup) ; le HTML d’impression y remplace la page blanche.
 *                        Sur **desktop**, laisser `undefined` : iframe caché, comme sans pré-onglet MikHmon.
 */
export function printMikhmonSmallVouchers(
  bodyTicketsHtml: string,
  documentTitle: string,
  preOpenedWindow?: Window | null,
): void {
  const html = buildMikhmonSmallVouchersPrintHtml(bodyTicketsHtml, documentTitle);
  dispatchVoucherPrintHtml(html, documentTitle, preOpenedWindow);
}

function printWithIframe(html: string, title: string): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", title);
  iframe.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:0;visibility:hidden;";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  if (!doc) {
    try {
      document.body.removeChild(iframe);
    } catch {
      /* ignore */
    }
    throw new Error("iframe document indisponible");
  }

  doc.open();
  doc.write(html);
  doc.close();
  doc.title = title;
  const te = doc.querySelector("title");
  if (te) te.textContent = title;

  const prevTitle = document.title;
  let parentTitleRestored = false;
  const restoreParentTitleOnce = () => {
    if (parentTitleRestored) return;
    parentTitleRestored = true;
    try {
      document.title = prevTitle;
    } catch {
      /* ignore */
    }
  };

  let safetyId: ReturnType<typeof setTimeout> | null = null;
  let printed = false;
  const cleanup = () => {
    if (safetyId != null) {
      window.clearTimeout(safetyId);
      safetyId = null;
    }
    try {
      document.body.removeChild(iframe);
    } catch {
      /* ignore */
    }
  };

  iframe.contentWindow?.addEventListener(
    "afterprint",
    () => {
      restoreParentTitleOnce();
      cleanup();
    },
    { once: true },
  );
  safetyId = window.setTimeout(() => {
    restoreParentTitleOnce();
    cleanup();
  }, 60_000);

  const runPrint = () => {
    if (printed) return;
    printed = true;
    try {
      document.title = title;
    } catch {
      /* ignore */
    }
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch (_) {
      if (safetyId != null) {
        window.clearTimeout(safetyId);
        safetyId = null;
      }
      restoreParentTitleOnce();
      cleanup();
      throw _;
    }
    /* Ne pas restaurer document.title ici : sur Chrome le dialogue « En-têtes et pieds de page »
     * lit parfois le titre après le retour de print() ; une restauration immédiate masquait l’en-tête. */
  };

  const schedulePrint = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(runPrint);
    });
  };

  const cw = iframe.contentWindow;
  if (cw?.document.readyState === "complete") {
    schedulePrint();
  } else {
    cw?.addEventListener("load", schedulePrint, { once: true });
    window.setTimeout(schedulePrint, 1500);
  }
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
    if (isMobileUserAgent() && !isNativeWebView()) {
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

  if (isMobileUserAgent()) {
    openPrintHtmlWindow(html, title);
  } else {
    printWithIframe(html, title);
  }
}
