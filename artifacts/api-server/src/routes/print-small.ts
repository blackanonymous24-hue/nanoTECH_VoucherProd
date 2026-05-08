import { Router } from "express";
import { eq } from "drizzle-orm";
import QRCode from "qrcode";
import { db, routersTable } from "@workspace/db";
import {
  listHotspotUsers,
  listProfiles,
  type RouterConnection,
} from "../lib/mikrotik.js";
import { resolveCallerScope } from "./routers.js";
import { logger } from "../lib/logger.js";

const router = Router();

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function buildQr(data: string): Promise<string> {
  try {
    return await QRCode.toDataURL(data || " ", {
      width: 70,
      margin: 1,
      color: { dark: "#000000", light: "#ffffff" },
    });
  } catch {
    return "";
  }
}

function errorPage(msg: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Erreur</title>
<style>body{font-family:sans-serif;padding:2rem;color:#c00;}</style></head>
<body><h2>Erreur</h2><p>${esc(msg)}</p></body></html>`;
}

/**
 * GET /api/print-small?routerId=X&lot=NAME&token=TOKEN
 * Rendu HTML mode "small" MikHmon — 2 tickets par ligne, impression navigateur native.
 * Le token peut être passé en query param car c'est un lien de navigation direct (pas fetch).
 */
router.get("/print-small", async (req, res): Promise<void> => {
  const { routerId: routerIdStr, lot, token: qToken } = req.query as {
    routerId?: string;
    lot?: string;
    token?: string;
  };

  // Accept token from Authorization header OR ?token= query param
  const rawToken = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "") || (qToken ?? "");

  if (!rawToken) {
    res.status(401).type("html").send(errorPage("Token d'authentification manquant."));
    return;
  }
  if (!routerIdStr || !lot) {
    res.status(400).type("html").send(errorPage("Paramètres manquants : routerId et lot requis."));
    return;
  }

  const routerId = parseInt(routerIdStr, 10);
  if (isNaN(routerId)) {
    res.status(400).type("html").send(errorPage("routerId invalide."));
    return;
  }

  // Resolve caller scope (admin/manager/vendor/collab)
  const scope = await resolveCallerScope({
    headers: { authorization: `Bearer ${rawToken}` },
  } as Parameters<typeof resolveCallerScope>[0]);

  if (!scope) {
    res.status(403).type("html").send(errorPage("Accès refusé."));
    return;
  }

  // Check router access
  if (scope.kind !== "super" && !scope.routerIds.includes(routerId)) {
    res.status(403).type("html").send(errorPage("Accès refusé à ce routeur."));
    return;
  }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, routerId));
  if (!r) {
    res.status(404).type("html").send(errorPage("Routeur introuvable."));
    return;
  }

  const conn: RouterConnection = { host: r.host, port: r.port, username: r.username, password: r.password };
  const hotspotName = r.hotspotName || r.name;
  const dnsname = r.contact ?? "";
  const currency = r.currency ?? "FCFA";

  try {
    // Fetch users + profiles in parallel
    const [allUsers, profiles] = await Promise.all([
      listHotspotUsers(conn, 30_000),
      listProfiles(conn).catch(() => [] as Awaited<ReturnType<typeof listProfiles>>),
    ]);

    // Filter to this lot only, skip disabled users
    const lotUsers = allUsers.filter((u) => (u.comment ?? "").trim() === lot.trim() && !u.disabled);

    if (lotUsers.length === 0) {
      res.type("html").send(errorPage(`Aucun voucher actif trouvé pour le lot « ${lot} ».`));
      return;
    }

    // Build profile map for quick lookup
    const profileMap = new Map(profiles.map((p) => [p.name, p]));

    // Generate QR codes in parallel
    const qrDataUris = await Promise.all(
      lotUsers.map((u) => {
        const usermode = u.username === u.password ? "vc" : "up";
        const qrData =
          usermode === "vc"
            ? u.username
            : `http://${dnsname}/login?username=${encodeURIComponent(u.username)}&password=${encodeURIComponent(u.password)}`;
        return buildQr(qrData);
      }),
    );

    // Build voucher HTML blocks
    const voucherHtml = lotUsers
      .map((u, i) => {
        const prof = profileMap.get(u.profile);
        const price = prof?.price ?? "";
        const validity = prof?.validity ?? "";
        const qrSrc = qrDataUris[i];

        const metaLine = [u.profile, validity, price ? `${price} ${currency}` : ""]
          .filter(Boolean)
          .join(" · ");

        return `<div class="voucher">
  <table width="100%">
    <tr>
      <td align="center">
        <b class="small-hotspot">${esc(hotspotName)}</b>
      </td>
    </tr>
    <tr>
      <td class="small-user" align="center">${esc(u.username)}</td>
    </tr>
    <tr>
      <td class="small-pass" align="center">${esc(u.password)}</td>
    </tr>
    <tr>
      <td class="small-profile" align="center">${esc(metaLine)}</td>
    </tr>
    ${qrSrc ? `<tr><td align="center"><img class="qr" src="${qrSrc}" alt="QR"></td></tr>` : ""}
  </table>
</div>`;
      })
      .join("\n");

    const safeLot = esc(lot);
    const safeHotspot = esc(hotspotName);

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${safeHotspot} — ${safeLot}</title>
  <style>
    @page {
      size: auto;
      margin-left: 7mm;
      margin-right: 3mm;
      margin-top: 9mm;
      margin-bottom: 3mm;
    }

    body {
      color: #000;
      background-color: #fff;
      font-size: 14px;
      font-family: Helvetica, Arial, sans-serif;
      margin: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .voucher {
      display: inline-block;
      vertical-align: top;
      width: 48%;
      border: 2px solid #000;
      margin: 2px;
      padding: 3px;
      box-sizing: border-box;
      overflow: hidden;
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }

    .voucher * {
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }

    @media print {
      table { page-break-after: auto; }
      tr { page-break-inside: avoid; page-break-after: auto; }
      td { page-break-inside: avoid; page-break-after: auto; }
      thead { display: table-header-group; }
      tfoot { display: table-footer-group; }
      .voucher {
        display: inline-block;
        width: 48%;
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }
      .no-print { display: none !important; }
    }

    .qr { width: 70px; height: 70px; }
    .small-hotspot { font-size: 13px; }
    .small-user { font-size: 18px; font-weight: bold; }
    .small-pass { font-size: 16px; }
    .small-profile { font-size: 12px; }

    /* Barre info visible à l'écran, cachée à l'impression */
    .no-print {
      background: #1e40af;
      color: #fff;
      padding: 8px 12px;
      font-size: 13px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .no-print button {
      background: #fff;
      color: #1e40af;
      border: none;
      border-radius: 4px;
      padding: 4px 12px;
      font-size: 13px;
      font-weight: bold;
      cursor: pointer;
    }
  </style>
  <script>
    window.onload = function() {
      setTimeout(function() { window.focus(); window.print(); }, 400);
    };
  <\/script>
</head>
<body>
  <div class="no-print">
    <span>${safeHotspot} &mdash; Lot : <b>${safeLot}</b> &mdash; ${lotUsers.length} ticket${lotUsers.length !== 1 ? "s" : ""}</span>
    <button onclick="window.print()">Imprimer</button>
  </div>
  ${voucherHtml}
</body>
</html>`;

    res.type("html").send(html);
  } catch (err) {
    logger.error({ err, routerId, lot }, "Erreur génération print-small");
    const msg = err instanceof Error ? err.message : "Erreur serveur";
    res.status(502).type("html").send(errorPage(`Impossible de contacter le routeur : ${msg}`));
  }
});

export default router;
