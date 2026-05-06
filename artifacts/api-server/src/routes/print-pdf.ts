import { Router } from "express";
import { verifyAdminToken } from "../lib/admin-auth.js";
import { logger } from "../lib/logger.js";
import type { Browser } from "puppeteer-core";

const router = Router();

let _browser: Browser | null = null;
let _browserLaunching: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (_browser) {
    try {
      await _browser.version();
      return _browser;
    } catch {
      _browser = null;
    }
  }

  if (!_browserLaunching) {
    _browserLaunching = (async (): Promise<Browser> => {
      try {
        const { execSync } = await import("child_process");
        let execPath = "";

        for (const candidate of ["chromium", "chromium-browser", "google-chrome"]) {
          try {
            execPath = execSync(`which ${candidate}`, { encoding: "utf8" }).trim();
            if (execPath) break;
          } catch { /* essai suivant */ }
        }

        if (!execPath) {
          const chromiumMin = (await import("@sparticuz/chromium-min")).default;
          execPath = await chromiumMin.executablePath(
            "https://github.com/Sparticuz/chromium/releases/download/v148.0.0/chromium-v148.0.0-pack.tar",
          );
        }

        const puppeteer = (await import("puppeteer-core")).default;
        const browser = await puppeteer.launch({
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
          ],
          executablePath: execPath,
          headless: true,
        });

        logger.info({ execPath }, "Chromium lancé pour la génération PDF");
        _browser = browser;
        return browser;
      } finally {
        _browserLaunching = null;
      }
    })();
  }

  return _browserLaunching;
}

router.post("/print-pdf", async (req, res) => {
  const auth = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  if (!verifyAdminToken(auth)) {
    res.status(401).json({ error: "Non autorisé" });
    return;
  }

  const { html, title, scale } = req.body as { html?: string; title?: string; scale?: number };
  if (!html || typeof html !== "string") {
    res.status(400).json({ error: "html requis (chaîne HTML complète)" });
    return;
  }

  let browser: Browser;
  try {
    browser = await getBrowser();
  } catch (err: unknown) {
    logger.error({ err }, "Impossible de lancer Chromium");
    const msg = err instanceof Error ? err.message : String(err);
    res.status(503).json({ error: `Chromium indisponible : ${msg}` });
    return;
  }

  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });

    // Mode screen : rendu identique au navigateur desktop (Edge)
    await page.emulateMediaType("screen");

    await page.setContent(html, { waitUntil: "networkidle0", timeout: 45_000 });

    // Attendre chargement complet (images, fonts, QR codes)
    await new Promise((r) => setTimeout(r, 1500));

    // Injecter CSS anti-découpage tickets (s'applique lors de la génération PDF)
    await page.addStyleTag({
      content: `
        @media print {
          body { -webkit-print-color-adjust: exact; }
          .ticket, .ticket-item, .row, tr {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
          table { page-break-inside: auto; }
          tr { page-break-inside: avoid; page-break-after: auto; }
        }
      `,
    });

    const pdfScale = typeof scale === "number" && scale > 0
      ? Math.min(2, Math.max(0.1, scale / 100))
      : 0.85;

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      scale: pdfScale,
      preferCSSPageSize: true,
      margin: { top: "10mm", right: "5mm", bottom: "10mm", left: "5mm" },
    });

    const safeName = (title ?? "tickets")
      .replace(/[^a-zA-Z0-9_\-]/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 80);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.pdf"`);
    res.send(Buffer.from(pdf));
  } catch (err: unknown) {
    logger.error({ err }, "Erreur génération PDF");
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Erreur génération PDF : ${msg}` });
  } finally {
    await page.close().catch(() => {/* ignore */});
  }
});

export default router;
