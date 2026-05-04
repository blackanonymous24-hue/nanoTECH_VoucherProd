import "source-map-support/register.js";
import { app } from "./app.js";
import { logger } from "./lib/logger.js";
import { ensureRouterCurrencyColumn, ensureRouterAutoDeleteSalesScriptsColumn } from "./lib/ensure-router-currency-column.js";
import { startRealtimeVendorSync, setOnVendorSyncComplete } from "./lib/vendor-sync.js";
import { warmProfileSnapshots } from "./lib/warm-profiles.js";
import { invalidateVendorPortalCache } from "./routes/vendor-portal.js";
import { startMaintenanceScheduler } from "./lib/maintenance-scheduler.js";
import { startAutoBypassSync } from "./lib/auto-bypass-sync.js";
import { startDashboardPriorityWarmer } from "./routes/routers.js";

const port = process.env.PORT ? parseInt(process.env.PORT) : 3001;

process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception — keeping process alive");
});

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection — keeping process alive");
});

// Clean shutdown on SIGTERM (sent by workflow manager on restart).
process.on("SIGTERM", () => {
  logger.info("SIGTERM received — shutting down");
  process.exit(0);
});

async function start() {
  // Open the port first so health checks pass immediately.
  await new Promise<void>((resolve) => {
    app.listen(port, "0.0.0.0", () => {
      logger.info({ port }, "API server started");
      resolve();
    });
  });

  // DB compat migrations (idempotent, fast on subsequent startups).
  await ensureRouterCurrencyColumn();
  await ensureRouterAutoDeleteSalesScriptsColumn();

  startRealtimeVendorSync();
  setOnVendorSyncComplete(invalidateVendorPortalCache);
  startMaintenanceScheduler();
  startAutoBypassSync();

  // Defer heavy MikroTik startup operations by 30 s so the process is
  // fully ready to serve HTTP requests before opening router connections.
  setTimeout(() => {
    void warmProfileSnapshots();
    startDashboardPriorityWarmer();
  }, 30_000);
}

void start();
