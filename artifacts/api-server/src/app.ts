import express from "express";
import pinoHttp from "pino-http";
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
