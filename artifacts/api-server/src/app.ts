import express from "express";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import { createProxyMiddleware } from "http-proxy-middleware";
import { logger } from "./lib/logger.js";
import { router } from "./routes/index.js";

export const app = express();

app.use(express.json({ limit: "10mb" }));

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
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
  app.use(express.static(frontendDist));
  // SPA fallback — all non-API routes return index.html
  app.get("/{*splat}", (_req, res) => {
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
