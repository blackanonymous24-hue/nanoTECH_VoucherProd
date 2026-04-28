import { pgTable, serial, text, boolean, timestamp, integer, primaryKey } from "drizzle-orm/pg-core";
import { routersTable } from "./routers.js";
import { adminSettingsTable } from "./admin-settings.js";

export const collaborateursTable = pgTable("collaborateurs", {
  id: serial("id").primaryKey(),
  // Tenant owner. Nullable during migration; backfilled to the original super-admin.
  ownerAdminId: integer("owner_admin_id").references(() => adminSettingsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const collaborateurRoutersTable = pgTable("collaborateur_routers", {
  collaborateurId: integer("collaborateur_id").notNull().references(() => collaborateursTable.id, { onDelete: "cascade" }),
  routerId: integer("router_id").notNull().references(() => routersTable.id, { onDelete: "cascade" }),
}, (table) => [
  primaryKey({ columns: [table.collaborateurId, table.routerId] }),
]);

export type Collaborateur = typeof collaborateursTable.$inferSelect;
