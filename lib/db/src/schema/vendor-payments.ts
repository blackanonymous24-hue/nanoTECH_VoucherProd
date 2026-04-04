import { pgTable, serial, integer, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { vendorsTable } from "./vendors.js";
import { routersTable } from "./routers.js";

export const vendorPaymentsTable = pgTable("vendor_payments", {
  id:        serial("id").primaryKey(),
  vendorId:  integer("vendor_id").notNull().references(() => vendorsTable.id, { onDelete: "cascade" }),
  routerId:  integer("router_id").notNull().references(() => routersTable.id, { onDelete: "cascade" }),
  weekStart: varchar("week_start", { length: 10 }).notNull(), // YYYY-MM-DD (Monday of the week)
  amount:    integer("amount").notNull(),
  note:      text("note"),
  paidAt:    timestamp("paid_at", { withTimezone: true }).defaultNow().notNull(),
});

export type VendorPayment = typeof vendorPaymentsTable.$inferSelect;
