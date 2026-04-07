import express from "express";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import { createProxyMiddleware } from "http-proxy-middleware";
import { logger } from "./lib/logger.js";
import { router } from "./routes/index.js";

export const app = express();

app.use(express.json());

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
