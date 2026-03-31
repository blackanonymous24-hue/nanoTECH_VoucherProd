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

app.use("/api", router);
