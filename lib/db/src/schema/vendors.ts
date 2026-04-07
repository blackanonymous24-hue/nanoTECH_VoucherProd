import { pgTable, serial, text, boolean, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { routersTable } from "./routers.js";

export const vendorsTable = pgTable("vendors", {
  id: serial("id").primaryKey(),
  routerId: integer("router_id").references(() => routersTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  username: text("username"),
  passwordHash: text("password_hash"),
  commentSuffix: text("comment_suffix"),
  commentSuffix2: text("comment_suffix2"),
  commissionRate: integer("commission_rate").notNull().default(0), // % of sales as remuneration (0-100)
  isDemo: boolean("is_demo").notNull().default(false),             // demo vendor: excluded from reports & billing
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertVendorSchema = createInsertSchema(vendorsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  passwordHash: true,
});
export type InsertVendor = z.infer<typeof insertVendorSchema>;
export type Vendor = typeof vendorsTable.$inferSelect;
