import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { routersTable } from "./routers.js";
import { vendorsTable } from "./vendors.js";

export const vouchersTable = pgTable("vouchers", {
  id: serial("id").primaryKey(),
  routerId: integer("router_id").notNull().references(() => routersTable.id, { onDelete: "cascade" }),
  vendorId: integer("vendor_id").references(() => vendorsTable.id, { onDelete: "set null" }),
  username: text("username").notNull(),
  password: text("password").notNull(),
  profileName: text("profile_name").notNull(),
  price: text("price").notNull().default(""),
  validity: text("validity").notNull().default(""),
  comment: text("comment"),
  printedAt: timestamp("printed_at", { withTimezone: true }),
  usedAt: timestamp("used_at", { withTimezone: true }),
  macAddress: text("mac_address"),
  salePrice: text("sale_price"),
  saleIp: text("sale_ip"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertVoucherSchema = createInsertSchema(vouchersTable).omit({
  id: true,
  createdAt: true,
});
export type InsertVoucher = z.infer<typeof insertVoucherSchema>;
export type Voucher = typeof vouchersTable.$inferSelect;
