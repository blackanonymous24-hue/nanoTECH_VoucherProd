import express from "express";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import { createProxyMiddleware } from "http-proxy-middleware";
import { logger } from "./lib/logger.js";
import { router } from "./routes/index.js";

export const app = express();

app.use(express.json({ limit: "10mb" }));

// pino-http v10: default export is callable at runtime but TS types declare it
// as a namespace when esModuleInterop is off — suppress the false-positive.
app.use(
  // @ts-ignore TS2349
  pinoHttp({
    logger,
    autoLogging: {
      ignore: (req) => req.url === "/api/healthz" || req.url === "/healthz",
    },
    serializers: {
      req(req: { id: unknown; method: string; url?: string }) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res: { statusCode: number }) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Prevent HTTP caching on all API routes so clients always get fresh data
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.use("/api", router);

// Routes /api inconnues → JSON 404 (évite de renvoyer index.html du SPA)
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Route API introuvable" });
});

// JSON error handler — catches body-parser 413, 400, and other API errors
// Must be AFTER the router so it only fires for /api paths that errored
app.use("/api", (err: Error & { status?: number; type?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = (err as any).status ?? (err as any).statusCode ?? 500;
  const message = err.message ?? "Erreur serveur";
  res.status(status).json({ error: message });
});

// Serve the compiled frontend if it exists (production deployment)
// CWD = artifacts/api-server when started via pnpm --filter
const frontendDist = path.resolve(process.cwd(), "../app/dist/public");
if (fs.existsSync(frontendDist)) {
  // Hashed assets (JS/CSS chunks from Vite) — immutable, cache 1 year
  app.use(
    "/assets",
    express.static(path.join(frontendDist, "assets"), {
      maxAge: "1y",
      immutable: true,
      etag: false,
    }),
  );
  // Chunk Vite absent (cache navigateur obsolète) → 404 texte, pas index.html
  // (sinon l'import dynamique échoue silencieusement et la page « Générer » reste vide).
  app.use("/assets", (_req, res) => {
    res.status(404).type("text/plain").send("Asset not found");
  });
  // Everything else (index.html, favicon, etc.) — always revalidate
  app.use(
    express.static(frontendDist, {
      maxAge: 0,
      etag: true,
      setHeaders(res, filePath) {
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    }),
  );
  // SPA fallback — all non-API routes return index.html
  app.get("/{*splat}", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(frontendDist, "index.html"));
  });
} else {
  // Development: proxy all non-API requests to the Vite dev server
  const vitePort = process.env.VITE_PORT ?? "23863";
  app.use(
    "/",
    createProxyMiddleware({
      target: `http://localhost:${vitePort}`,
      changeOrigin: true,
      ws: true,
    }),
  );
}
