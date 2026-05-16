import "source-map-support/register.js";
import "./load-env.js";
import { app } from "./app.js";
import { logger } from "./lib/logger.js";
import { ensureRouterCurrencyColumn, ensureRouterAutoDeleteSalesScriptsColumn, ensureDropAdminSettingsVoucherPrintColumns, ensureTicketTemplateColumn, ensurePasswordPlainColumn, ensureVendorPasswordPlainColumn, ensureManagerPasswordPlainColumn, ensureCollaborateurPasswordPlainColumn, ensureVerificationCodeColumn, ensureSuperAdminPasswordPlainBackfill, ensureVendorTicketLetterColumn, ensurePrintScaleColumns, ensureSessionEpochColumns } from "./lib/ensure-router-currency-column.js";
import { startRealtimeVendorSync, setOnVendorSyncComplete } from "./lib/vendor-sync.js";
import { warmProfileSnapshots } from "./lib/warm-profiles.js";
import { invalidateVendorPortalCache } from "./routes/vendor-portal.js";
import { startMaintenanceScheduler } from "./lib/maintenance-scheduler.js";
import { startAutoBypassSync } from "./lib/auto-bypass-sync.js";
// startDashboardPriorityWarmer est désactivé : le poller SSE partagé (mikrotik-poller.ts)
// prend en charge le préchauffage des caches à la demande par routeur actif.
// Le warmer interrogeait TOUS les routeurs toutes les 20 s même sans client connecté,
// ce qui provoquait des erreurs "Rate exceeded" sur les routeurs non utilisés.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { startDashboardPriorityWarmer as _unused } from "./routes/routers.js";

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
  // DB compat migrations first — otherwise early /api/login can SELECT admin_settings
  // before missing columns exist (race) or fail permanently on older DBs.
  await ensureRouterCurrencyColumn();
  await ensureRouterAutoDeleteSalesScriptsColumn();
  await ensureDropAdminSettingsVoucherPrintColumns();
  await ensureTicketTemplateColumn();
  await ensurePasswordPlainColumn();
  await ensureVendorPasswordPlainColumn();
  await ensureManagerPasswordPlainColumn();
  await ensureCollaborateurPasswordPlainColumn();
  await ensureVerificationCodeColumn();
  await ensureVendorTicketLetterColumn();
  await ensurePrintScaleColumns();
  await ensureSessionEpochColumns();
  await ensureSuperAdminPasswordPlainBackfill();

  await new Promise<void>((resolve) => {
    app.listen(port, "0.0.0.0", () => {
      logger.info({ port }, "API server started");
      resolve();
    });
  });

  startRealtimeVendorSync();
  setOnVendorSyncComplete(invalidateVendorPortalCache);
  startMaintenanceScheduler();
  startAutoBypassSync();

  // Defer heavy MikroTik startup operations by 30 s so the process is
  // fully ready to serve HTTP requests before opening router connections.
  setTimeout(() => {
    void warmProfileSnapshots();
    // startDashboardPriorityWarmer() supprimé : le poller SSE partagé remplace le warmer
    // et ne tourne QUE pour les routeurs ayant des clients SSE actifs.
  }, 30_000);
}

void start();
