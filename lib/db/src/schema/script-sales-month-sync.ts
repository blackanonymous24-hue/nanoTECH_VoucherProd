import { pgTable, serial, integer, timestamp, unique, index } from "drizzle-orm/pg-core";
import { routersTable } from "./routers.js";

/**
 * Suivi de synchro MikroTik par routeur et par mois calendaire.
 * Mois passés « vérifiés » (sync + dédoublonnage) → plus de pull routeur pour ce mois.
 */
export const scriptSalesMonthSyncTable = pgTable("mikrotik_script_sales_month_sync", {
  id: serial("id").primaryKey(),
  routerId: integer("router_id").notNull().references(() => routersTable.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  month: integer("month").notNull(),
  /** Dernier pull MikroTik réussi pour ce mois (y compris mois en cours). */
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }).notNull().defaultNow(),
  /** Mois clos : sync complète + dédoublonnage validés — ne plus interroger le routeur. */
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  scriptCount: integer("script_count").notNull().default(0),
}, (t) => [
  unique("uq_script_month_sync_router_ym").on(t.routerId, t.year, t.month),
  index("idx_script_month_sync_router").on(t.routerId),
]);

export type ScriptSalesMonthSync = typeof scriptSalesMonthSyncTable.$inferSelect;
