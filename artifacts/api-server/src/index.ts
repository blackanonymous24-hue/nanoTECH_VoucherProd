import "source-map-support/register.js";
import { app } from "./app.js";
import { logger } from "./lib/logger.js";
import { ensureRouterCurrencyColumn } from "./lib/ensure-router-currency-column.js";
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

async function start() {
  await ensureRouterCurrencyColumn();
  app.listen(port, "0.0.0.0", () => {
    logger.info({ port }, "API server started");
    startRealtimeVendorSync();
    // After each vendor sync, invalidate the vendor portal cache so the next
    // request gets fresh data (stale-while-revalidate).
    setOnVendorSyncComplete(invalidateVendorPortalCache);
    // Pre-warm profile snapshots in background — ensures fast response even
    // after a restart and provides a DB fallback for offline routers.
    void warmProfileSnapshots();
    // Maintenance automatique : purge des vouchers fantômes toutes les heures
    // et suppression des anciens scripts MikHmon le 1er de chaque mois.
    startMaintenanceScheduler();
    startAutoBypassSync();
    startDashboardPriorityWarmer();
  });
}

void start();
