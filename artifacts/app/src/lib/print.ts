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
    /* Numéro de ticket MikHmon — float fiable en print desktop (flex ne l'est pas) */
    span#num { float:right !important; margin-left:4px !important; clear:none !important; }
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

/**
 * Bloc `<style>` inline de Mikhmon v3 (`hotspot/print.php`), copie littérale.
 * Réf. dépôt : `attached_assets/print_1778220636691.php` (l. 117–156).
 */
const MIKHMON_V3_PRINT_PHP_INLINE_CSS = `
body {
  color: #000000;
  background-color: #FFFFFF;
  font-size: 14px;
  font-family:  'Helvetica', arial, sans-serif;
  margin: 0px;
  -webkit-print-color-adjust: exact;
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
 * À **100 %** : aucune règle → même rendu que Mikhmon (`print.php` sans zoom navigateur).
 *
 * Sinon : reproduit l’effet du **zoom document** dans Edge / Chrome (Chromium) avant
 * « Imprimer » ou « Enregistrer au format PDF » — zoom menu ⋮, Ctrl+molette, etc. :
 * la mise en page est recalculée comme avec ce zoom (proche du moteur Blink), pas un simple `transform` décoratif.
 * Firefox gère `zoom` différemment ; le référencement cible Edge / Chrome comme demandé.
 */
function tenantDocumentZoomCss(scale: number): string {
  const s = Number(scale);
  if (!Number.isFinite(s) || (s >= 0.999 && s <= 1.001)) return "";
  const percent = Math.round(s * 1000) / 10;
  return `
/* nanoTECH : équivalent zoom page Edge/Chrome ; omis à 100 % (Mikhmon typique) */
html {
  zoom: ${percent}%;
  margin: 0;
  padding: 0;
}
`;
}

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
export function buildTicketPrintHtml(htmlItems: string[], title: string, scale = 85, mobile = false): string {
  return buildHtml(htmlItems, title, true, scale, mobile);
}

/**
 * Construit le HTML pour la génération PDF Puppeteer.
 *
 * Correctifs spécifiques PDF (distincts de l'impression navigateur) :
 * - Pas de blocs de 32 ni de 4 colonnes forcées : tickets inline-block,
 *   flux libre, Puppeteer pagine selon ce qui tient à l'échelle choisie.
 * - @page { margin:0 } : marges gérées par le lecteur PDF.
 * - Pas de zoom CSS : l'échelle est gérée par page.pdf({ scale }).
 * - text-align:left sur chaque ticket : évite que text-align:center du body
 *   cascade dans les cellules du template PHP et provoque des retours à la ligne.
 * - Pas de règle * { box-sizing } : n'interfère pas avec les largeurs du template.
 */
export function buildTicketHtmlForPdf(htmlItems: string[], title: string): string {
  const items = htmlItems
    .map(item =>
      `<div style="display:block;width:80mm;text-align:left;page-break-inside:avoid;break-inside:avoid;padding:0;margin:0;">${item}</div>`,
    )
    .join("");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      /* Ticket thermique 80mm — rendu identique Edge Ctrl+P 85% */
      @page {
        size: 80mm auto;
        margin: 0;
      }
      @page :first { margin: 0; }
      @page :left  { margin: 0; }
      @page :right { margin: 0; }

      html, body {
        margin: 0;
        padding: 0;
        width: 80mm;
        background: #fff;
        color: #000;
        font-size: 14px;
        font-family: Helvetica, Arial, sans-serif;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    </style>
  </head>
  <body>${items}</body>
</html>`;
}

function buildHtml(htmlItems: string[], title: string, autoprint: boolean, scale = 85, mobile = false): string {
  const COLS = 4;

  // ═══════════════════════════════════════════════════════════════════════════
  // ─── CHEMIN MOBILE — flux libre ───────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  if (mobile) {
    const s = scale / 100;

    // Colonnes auto : on lit la largeur native du ticket (attribut width sur la <table>)
    // pour calculer combien de colonnes tiennent sur une page A4 avec ce zoom.
    // Chaque cellule prend exactement 1/cols × 100 % → ligne remplie à 100 %, aucune marge.
    const firstItem = htmlItems[0] ?? "";
    const tableWidthMatch = firstItem.match(/<table[^>]+width=['"]?(\d+)/i);
    const ticketNativePx = tableWidthMatch ? parseInt(tableWidthMatch[1], 10) : 200;
    // A4 print = ~794 CSS px. Avec zoom:s sur html, le contenu dispose de 794/s px.
    const effectivePagePx = Math.round(794 / s);
    const cols = Math.max(1, Math.floor(effectivePagePx / (ticketNativePx + 4)));
    const cellWidthPct = (100 / cols).toFixed(4);

    const cells = htmlItems
      .map(item => `<div class="ticket-cell"><div class="ticket">${item}</div></div>`)
      .join("");
    const tableHtml = `<div class="ticket-page">${cells}</div>`;

    // @page DOIT être à la racine (Safari iOS l'ignore dans @media print).
    const mobilePageCss = `
      @page        { margin: 0; }
      @page :first { margin: 0; }
      @page :left  { margin: 0; }
      @page :right { margin: 0; }
    `;

    // zoom sur html = dezoom sans stacking context (transform:scale le casse).
    const mobilePrintCss = `
      html { zoom: ${s}; margin: 0; padding: 0; }
      html, body { margin: 0; padding: 0; }
      body {
        color: #000; background: #fff; text-align: center;
        font-size: 14px; font-family: Helvetica, Arial, sans-serif;
        -webkit-print-color-adjust: exact; print-color-adjust: exact;
      }
      .doc-header { display: none !important; }

      /* Conteneur global : font-size:0 supprime l'espace entre inline-blocks.
         text-align:left — tickets partent du bord gauche, pas de marge centrée. */
      .ticket-page {
        display: block;
        text-align: left;
        font-size: 0;
        overflow: visible !important;
      }

      /* Cellule = ${cellWidthPct}% (calculé : 100 % / ${cols} colonnes).
         Remplit exactement toute la largeur de la page — aucune marge résiduelle.
         La largeur est fixe (pas auto) → width:100% sur la table fille ne crée
         pas de référence circulaire. */
      .ticket-cell {
        display: inline-block;
        width: ${cellWidthPct}%;
        vertical-align: top;
        padding: 1px;
        box-sizing: border-box;
        font-size: 14px;
        break-inside: avoid !important;
        page-break-inside: avoid !important;
        -webkit-column-break-inside: avoid !important;
        overflow: visible !important;
      }

      /* .ticket = boîte clippante pour le contenu interne. */
      .ticket {
        display: block;
        overflow: hidden !important;
        break-inside: avoid !important;
        page-break-inside: avoid !important;
      }

      /* Template PHP : force display:table, occupe toute la cellule (largeur fixe %),
         position:relative + overflow:hidden clippent le triangle décoratif CSS. */
      .ticket > table {
        display: table !important;
        width: 100% !important;
        box-sizing: border-box !important;
        overflow: hidden !important;
        position: relative !important;
      }

      /* Numéro de ticket MikHmon — forcé à droite même en mobile */
      span#num { float:right !important; margin-left:4px !important; clear:none !important; }

      /* float casse le flux d'impression */
      .ticket img { float: none !important; display: inline-block !important; }

      /* overflow:visible sur les conteneurs de pagination (Safari page-break).
         .ticket reste en overflow:hidden pour clipper son contenu. */
      body, .ticket-page, .ticket-cell {
        overflow: visible !important;
      }

      /* Template MikHmon (class="voucher") */
      table.voucher {
        border: 1px solid #444 !important;
        box-sizing: border-box !important;
      }

      @media screen { body { padding-bottom: 100px; } }
    `;

    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${title}</title>
    <style>${mobilePageCss}</style>
    <style>${mobilePrintCss}</style>
    ${autoprint ? `<script>window.onload=function(){setTimeout(function(){window.focus();window.print();},500);}<\/script>` : ""}
  </head>
  <body>${tableHtml}</body>
</html>`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ─── CHEMIN DESKTOP ───────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  const PER_PAGE = COLS * 8;
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

  // ─── CSS desktop (inchangé) ──────────────────────────────────────────────
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
 * ── Échelles vouchers (page **Modèle de ticket**) ────────────────────────────
 * Deux curseurs distincts → deux `html { zoom }` via {@link tenantDocumentZoomCss} :
 *
 * - **Web bureau** : `scaleSmall` (fraction 0–1, ex. serveur `scaleSmall / 100`) → passer à cette fonction en **troisième argument**.
 * - **Mobile** : `scaleMobile` (pourcent entier, ex. `85`) → passer **`scaleMobile / 100`** en troisième argument (navigateur mobile, `window.open`).
 * - **APK** : même réglage **Mobile** (%), via {@link printTickets} uniquement (pont natif).
 *
 * Document « small » : CSS = bloc `<style>` de Mikhmon v3 `print.php` (inchangé).
 * À 100 %, aucun `html { zoom }` — comportement Mikhmon natif ; sinon zoom façon Edge/Chrome (voir `tenantDocumentZoomCss`).
 * Le corps des tickets vient du preset PHP (`template-small.php` équivalent).
 *
 * @param defaultScale Facteur 0–1 : **Small** sur desktop web, **Mobile/100** sur mobile ou dans `printTickets`.
 * @param autoprint Si false, pas de `body onload` (iframe bureau / APK ; expo-print ne s’appuie pas sur ce script).
 */
export function buildSmallModePrintHtml(
  htmlItems: string[],
  title: string,
  defaultScale = 1,
  opts?: { autoprint?: boolean },
): string {
  const autoprint = opts?.autoprint !== false;
  const safeTitle = title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const css = `${tenantDocumentZoomCss(defaultScale)}
${MIKHMON_V3_PRINT_PHP_INLINE_CSS}`;

  const bodyOpen = autoprint ? `<body onload="window.print()">` : "<body>";

  return `<!DOCTYPE html>
<html>
<head>
  <title>${safeTitle}</title>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta http-equiv="pragma" content="no-cache" />
  <style>${css}</style>
</head>
${bodyOpen}${htmlItems.join("\n")}</body>
</html>`;
}

/**
 * Impression vouchers **depuis l’APK uniquement** (React Native WebView → postMessage → expo-print).
 * Utilise le curseur **« Mobile »** du modèle de ticket (`scaleMobile`, en pourcent : `85` → zoom 85 %).
 *
 * Ne pas utiliser pour le web : le bureau utilise `buildSmallModePrintHtml(..., scaleSmall)` ; le navigateur mobile,
 * `buildSmallModePrintHtml(..., scaleMobile / 100)` dans une fenêtre dédiée — ce sont des `html { zoom }` différents.
 */
export function printTickets(htmlItems: string[], title: string, scaleMobilePercent = 100): void {
  if (!isNativeWebView()) {
    console.warn(
      "[printTickets] réservé au WebView natif (APK). Côté web, utilisez buildSmallModePrintHtml avec scaleSmall (bureau) ou scaleMobile/100 (mobile).",
    );
    return;
  }
  const html = buildSmallModePrintHtml(htmlItems, title, scaleMobilePercent / 100, { autoprint: false });
  printWithNativeBridge(html, title);
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
