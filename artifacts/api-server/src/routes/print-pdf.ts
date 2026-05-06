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
    // Viewport desktop stable — évite les media queries mobiles dans le template
    await page.setViewport({ width: 800, height: 1200, deviceScaleFactor: 1 });

    await page.emulateMediaType("print");
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 45_000 });

    // scale : 0.1–2.0 (Puppeteer natif = zoom optique post-rendu, comme le curseur Edge Ctrl+P)
    // 0.82 ≈ 85% Edge (Edge applique ses propres marges par défaut qui réduisent légèrement l'espace)
    const pdfScale = typeof scale === "number" && scale > 0
      ? Math.min(2, Math.max(0.1, scale / 100))
      : 0.82;

    // Puppeteer ne supporte pas height:"auto" — on mesure la hauteur réelle du contenu
    const contentHeightPx = await page.evaluate(() => document.documentElement.scrollHeight);
    // Conversion px → mm (96 dpi CSS standard : 1px = 25.4/96 mm)
    const contentHeightMm = Math.ceil((contentHeightPx * 25.4) / 96);

    const pdf = await page.pdf({
      width: "80mm",
      height: `${contentHeightMm}mm`,
      printBackground: true,
      scale: pdfScale,
      margin: { top: "0px", right: "0px", bottom: "0px", left: "0px" },
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
