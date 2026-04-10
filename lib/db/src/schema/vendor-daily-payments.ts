import { pgTable, serial, integer, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { vendorsTable } from "./vendors.js";
import { routersTable } from "./routers.js";

export const vendorDailyPaymentsTable = pgTable("vendor_daily_payments", {
  id:       serial("id").primaryKey(),
  vendorId: integer("vendor_id").notNull().references(() => vendorsTable.id, { onDelete: "cascade" }),
  routerId: integer("router_id").notNull().references(() => routersTable.id, { onDelete: "cascade" }),
  date:     varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD
  amount:   integer("amount").notNull(),
  note:     text("note"),
  paidAt:   timestamp("paid_at", { withTimezone: true }).defaultNow().notNull(),
});

export type VendorDailyPayment = typeof vendorDailyPaymentsTable.$inferSelect;
