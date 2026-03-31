import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { profilesTable } from "./profiles";

export const vouchersTable = pgTable("vouchers", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  profileId: integer("profile_id").notNull().references(() => profilesTable.id, { onDelete: "cascade" }),
  profileName: text("profile_name").notNull().default(""),
  status: text("status").notNull().default("available"),
  batchId: text("batch_id"),
  batchName: text("batch_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  soldAt: timestamp("sold_at", { withTimezone: true }),
});

export const insertVoucherSchema = createInsertSchema(vouchersTable).omit({ id: true, createdAt: true });
export type InsertVoucher = z.infer<typeof insertVoucherSchema>;
export type Voucher = typeof vouchersTable.$inferSelect;
