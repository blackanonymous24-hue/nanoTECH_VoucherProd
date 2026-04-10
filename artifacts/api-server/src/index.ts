import "source-map-support/register.js";
import { app } from "./app.js";
import { logger } from "./lib/logger.js";
import { startRealtimeVendorSync } from "./lib/vendor-sync.js";
import { warmProfileSnapshots } from "./lib/warm-profiles.js";

const port = process.env.PORT ? parseInt(process.env.PORT) : 3001;

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception — keeping process alive");
});

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection — keeping process alive");
});

app.listen(port, "0.0.0.0", () => {
  logger.info({ port }, "API server started");
  startRealtimeVendorSync();
  // Pre-warm profile snapshots in background — ensures fast response even
  // after a restart and provides a DB fallback for offline routers.
  void warmProfileSnapshots();
});
