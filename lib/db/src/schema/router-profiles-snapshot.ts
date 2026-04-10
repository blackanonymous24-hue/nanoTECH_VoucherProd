import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { routersTable } from "./routers.js";

/**
 * Persists the last known MikroTik profile list per router as JSON.
 * Used as fallback when the router is unreachable after a server restart.
 */
export const routerProfilesSnapshotTable = pgTable("router_profiles_snapshot", {
  id:           serial("id").primaryKey(),
  routerId:     integer("router_id").notNull().unique().references(() => routersTable.id, { onDelete: "cascade" }),
  profilesJson: text("profiles_json").notNull(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RouterProfilesSnapshot = typeof routerProfilesSnapshotTable.$inferSelect;
