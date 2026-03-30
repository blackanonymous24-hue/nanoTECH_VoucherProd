import { pgTable, text, serial, timestamp, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vouchersTable } from "./vouchers";
import { profilesTable } from "./profiles";

export const salesTable = pgTable("sales", {
  id: serial("id").primaryKey(),
  voucherId: integer("voucher_id").notNull().references(() => vouchersTable.id),
  voucherCode: text("voucher_code").notNull(),
  profileId: integer("profile_id").notNull().references(() => profilesTable.id),
  profileName: text("profile_name").notNull(),
  amount: real("amount").notNull(),
  paymentMethod: text("payment_method").notNull(),
  operatorName: text("operator_name"),
  customerName: text("customer_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSaleSchema = createInsertSchema(salesTable).omit({ id: true, createdAt: true });
export type InsertSale = z.infer<typeof insertSaleSchema>;
export type Sale = typeof salesTable.$inferSelect;
