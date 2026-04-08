import { pgTable, serial, text, boolean, timestamp, integer } from "drizzle-orm/pg-core";
import { routersTable } from "./routers.js";

export const managersTable = pgTable("managers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash"),
  isActive: boolean("is_active").notNull().default(true),
  routerId: integer("router_id").references(() => routersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Manager = typeof managersTable.$inferSelect;
