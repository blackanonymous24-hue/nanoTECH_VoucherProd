import { pgTable, serial, text, integer, timestamp, unique, index } from "drizzle-orm/pg-core";
import { routersTable } from "./routers.js";

/**
 * Local cache of MikHMon sales script entries.
 *
 * Instead of fetching thousands of scripts from MikroTik on every sync,
 * we persist them here and only pull the current month's entries on each
 * incremental run. The raw script name IS the data (MikHMon format).
 *
 * Unique constraint: (routerId, rawName) — the raw script name is unique
 * per router (it encodes date+time+username+price+ip+mac+batch).
 */
export const scriptSalesTable = pgTable("mikrotik_script_sales", {
  id:        serial("id").primaryKey(),
  routerId:  integer("router_id").notNull().references(() => routersTable.id, { onDelete: "cascade" }),
  username:  text("username").notNull(),
  saleDate:  timestamp("sale_date", { withTimezone: true }).notNull(),
  price:     text("price").notNull().default(""),
  ip:        text("ip").notNull().default(""),
  mac:       text("mac").notNull().default(""),
  validity:  text("validity").notNull().default(""),
  label:     text("label").notNull().default(""),
  batch:     text("batch").notNull().default(""),
  rawName:   text("raw_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("uq_script_sales_router_raw").on(t.routerId, t.rawName),
  index("idx_script_sales_router_date").on(t.routerId, t.saleDate),
]);

export type ScriptSale = typeof scriptSalesTable.$inferSelect;
