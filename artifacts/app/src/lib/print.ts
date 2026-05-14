import {
  clampVoucherPrintScale,
  getVoucherPrintScaleDesktop,
  getVoucherPrintScaleMobile,
} from "./voucher-print-scale";

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

const ADMIN_TOKEN_KEY = "vouchernet_admin_token";

function readAdminAuthToken(): string | null {
  try {
    return localStorage.getItem(ADMIN_TOKEN_KEY) ?? sessionStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}

function isMobileUa(): boolean {
  return /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function voucherPrintScalePercentForCurrentContext(): number {
  if (typeof window === "undefined") return 100;
  if (window.ReactNativeWebView) return getVoucherPrintScaleMobile();
  if (isMobileUa()) return getVoucherPrintScaleMobile();
  return getVoucherPrintScaleDesktop();
}

/** Applique l’échelle d’impression autour du HTML des tickets. */
export function wrapVoucherTicketsBodyForPrintScale(bodyHtml: string, scalePercent: number): string {
  const pct = clampVoucherPrintScale(scalePercent);
  if (pct <= 0 || pct >= 100) return bodyHtml;
  const f = pct / 100;
  /**
   * `zoom` est bien pris en charge à l’écran sur Chrome, mais l’aperçu / l’impression **mobile**
   * (Safari iOS, WebView, souvent Firefox) l’ignore ou l’applique mal. `transform: scale` + largeur
   * compensée est le contrepoids classique pour que l’échelle se voie aussi à l’impression.
   */
  return `<div class="vn-voucher-scale-wrap" style="box-sizing:border-box;-webkit-transform-origin:top left;transform-origin:top left;-webkit-transform:scale(${f});transform:scale(${f});width:calc(100% / ${f});">${bodyHtml}</div>`;
}

/**
 * Mikhmon v3 : `window.open(URL)` → GET → document HTML avec `onload` → `print()`.
 * Retourne `false` si WebView native (pont d’impression requis) ou jeton absent.
 * Par défaut pas de `refresh=1` : le serveur interroge le lot via `?comment=` sur MikroTik (rapide).
 * Passer `refresh: true` seulement si un lot récent n’apparaît pas (repli cache liste complète).
 */
export function openMikhmonVoucherPrintByUrl(
  baseUrl: string,
  routerId: number,
  comment: string,
  opts?: { refresh?: boolean },
): boolean {
  if (typeof window === "undefined" || isNativeWebView()) return false;
  const token = readAdminAuthToken();
  if (!token) return false;

  const prefix = baseUrl.replace(/\/$/, "");
  const path = `${prefix}/api/routers/${routerId}/voucher-print-small`;
  const u = new URL(path, window.location.origin);
  u.searchParams.set("comment", comment);
  u.searchParams.set("token", token);
  u.searchParams.set("scale", String(voucherPrintScalePercentForCurrentContext()));
  if (opts?.refresh === true) u.searchParams.set("refresh", "1");

  const win = window.open(u.toString(), "_blank");
  try {
    win?.focus();
  } catch {
    /* ignore */
  }
  return true;
}

function isMobile(): boolean {
  return isMobileUa();
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
export function buildStandalonePrintHtml(
  title: string,
  styleCss: string,
  bodyHtml: string,
  opts?: { deferPrintMs?: number; autoprint?: boolean },
): string {
  const safeTitle = title.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const defer = opts?.deferPrintMs ?? 0;
  const autoprint = opts?.autoprint !== false;
  const printScript =
    defer > 0
      ? `window.onload=function(){window.focus();setTimeout(function(){window.print();},${defer});};`
      : `window.onload=function(){window.focus();window.print();};`;
  const scriptTag = autoprint ? `    <script>${printScript}<\/script>` : "";
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${safeTitle}</title>
    <style>${styleCss}</style>
${scriptTag}
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
.vn-voucher-scale-wrap {
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
`;

function buildMikhmonVoucherPrintDocumentHtml(
  bodyTicketsHtml: string,
  documentTitle: string,
  opts?: { autoprint?: boolean },
): string {
  const scaledBody = wrapVoucherTicketsBodyForPrintScale(bodyTicketsHtml, voucherPrintScalePercentForCurrentContext());
  return buildStandalonePrintHtml(documentTitle, MIKHMON_VOUCHER_PRINT_CSS, scaledBody, {
    deferPrintMs: 150,
    autoprint: opts?.autoprint !== false,
  });
}

/**
 * Ouvre **tout de suite** un onglet (même geste utilisateur) avec une page de chargement.
 * À utiliser avant tout `await` dans le gestionnaire d’impression, sinon le navigateur
 * bloque `window.open` après chargement de milliers de vouchers.
 * WebView native : retourne `null` (pas d’onglet ; utiliser `printMikhmonSmallVouchers` à la fin).
 */
export function openMikhmonVoucherPrintLoadingTab(documentTitle: string): Window | null {
  if (typeof window === "undefined" || isNativeWebView()) return null;
  const win = window.open("", "_blank");
  if (!win) return null;
  const safeTitle = documentTitle.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  win.document.open();
  win.document.write(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #fafafa; color: #1e293b; }
    .vn-spin { width: 40px; height: 40px; border: 3px solid #e5e7eb; border-top-color: #7c3aed; border-radius: 50%; animation: vn-spin-360 0.75s linear infinite; }
    @keyframes vn-spin-360 { to { transform: rotate(360deg); } }
    p { margin: 1rem 1.25rem 0; font-size: 14px; max-width: 22rem; text-align: center; line-height: 1.45; }
    .vn-sub { font-size: 12px; color: #64748b; margin-top: 0.5rem; }
  </style>
</head>
<body>
  <div class="vn-spin" aria-hidden="true"></div>
  <p>Préparation des tickets pour l’impression…<span class="vn-sub">Ne fermez pas cet onglet. Vous pouvez l’ignorer si vous avez annulé depuis l’application.</span></p>
</body>
</html>`);
  win.document.close();
  try {
    win.document.title = documentTitle;
  } catch {
    /* ignore */
  }
  try {
    win.focus();
  } catch {
    /* ignore */
  }
  return win;
}

/** Remplace le contenu d’un onglet ouvert par {@link openMikhmonVoucherPrintLoadingTab} par le document d’impression. */
export function applyMikhmonVoucherPrintHtmlToTab(
  win: Window,
  bodyTicketsHtml: string,
  documentTitle: string,
): void {
  if (isNativeWebView()) {
    printWithNativeBridge(
      buildMikhmonVoucherPrintDocumentHtml(bodyTicketsHtml, documentTitle, { autoprint: true }),
      documentTitle,
    );
    return;
  }

  /**
   * Après `document.write` sur un onglet qui avait déjà fini de charger (page « Préparation… »),
   * `window.onload` du nouveau document ne se déclenche souvent plus → pas d’auto-print.
   * On injecte le HTML **sans** script d’impression et on appelle `print()` après un court délai
   * (mise en page / QR) depuis ce contexte.
   */
  const html = buildMikhmonVoucherPrintDocumentHtml(bodyTicketsHtml, documentTitle, { autoprint: false });
  win.document.open();
  win.document.write(html);
  win.document.close();
  try {
    win.document.title = documentTitle;
  } catch {
    /* ignore */
  }
  const invokePrint = (): void => {
    try {
      win.focus();
      win.print();
    } catch {
      /* ignore */
    }
  };
  win.setTimeout(invokePrint, 320);
}

export function showMikhmonVoucherPrintErrorInTab(win: Window, message: string): void {
  if (isNativeWebView()) return;
  const safe = String(message)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  win.document.open();
  win.document.write(`<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"/><title>Impression</title>
<style>body{font-family:system-ui,sans-serif;padding:1.5rem;max-width:36rem;margin:0 auto;color:#b91c1c;background:#fef2f2}</style>
</head><body><p><strong>Impression impossible</strong></p><p>${safe}</p></body></html>`);
  win.document.close();
}

/**
 * Impression des vouchers — **HTML + `print()` au chargement** (styles Mikhmon v3).
 * Utiliser ce chemin depuis l’app (gabarit + échelle alignés sur l’éditeur / localStorage).
 * Pour les gros lots, préférer {@link openMikhmonVoucherPrintLoadingTab} puis {@link applyMikhmonVoucherPrintHtmlToTab}.
 * `openMikhmonVoucherPrintByUrl` reste disponible pour un onglet serveur ponctuel si besoin.
 * WebView native (APK) : pont d’impression inchangé.
 */
export function printMikhmonSmallVouchers(bodyTicketsHtml: string, documentTitle: string): void {
  const html = buildMikhmonVoucherPrintDocumentHtml(bodyTicketsHtml, documentTitle);

  if (isNativeWebView()) {
    printWithNativeBridge(html, documentTitle);
    return;
  }

  openPrintHtmlWindow(html, documentTitle);
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

  const cleanup = () => {
    try {
      document.body.removeChild(iframe);
    } catch {
      /* ignore */
    }
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
