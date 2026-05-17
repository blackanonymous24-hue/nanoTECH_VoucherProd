import { pgTable, serial, text, boolean, timestamp, integer, primaryKey } from "drizzle-orm/pg-core";
import { routersTable } from "./routers.js";
import { adminSettingsTable } from "./admin-settings.js";

export const managersTable = pgTable("managers", {
  id: serial("id").primaryKey(),
  // Tenant owner. Nullable during migration; backfilled to the original super-admin.
  ownerAdminId: integer("owner_admin_id").references(() => adminSettingsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash"),
  passwordPlain: text("password_plain"),
  isActive: boolean("is_active").notNull().default(true),
  sessionEpoch: integer("session_epoch").notNull().default(0),
  /** Legacy : premier routeur assigné (miroir de manager_routers). */
  routerId: integer("router_id").references(() => routersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const managerRoutersTable = pgTable("manager_routers", {
  managerId: integer("manager_id").notNull().references(() => managersTable.id, { onDelete: "cascade" }),
  routerId: integer("router_id").notNull().references(() => routersTable.id, { onDelete: "cascade" }),
}, (table) => [
  primaryKey({ columns: [table.managerId, table.routerId] }),
]);

export type Manager = typeof managersTable.$inferSelect;
