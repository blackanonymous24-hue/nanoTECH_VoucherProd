import { pgTable, serial, text, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { routersTable } from "./routers.js";

/**
 * Persists the MikroTik internal profile ID → name mapping per router.
 * MikroTik's profile .id (e.g. "*1") is immutable even when the profile
 * is renamed — so by tracking it we can detect renames and bulk-update
 * all voucher records (including already-sold ones) automatically.
 */
export const profilesCacheTable = pgTable(
  "profiles_cache",
  {
    id:          serial("id").primaryKey(),
    routerId:    integer("router_id").notNull().references(() => routersTable.id, { onDelete: "cascade" }),
    mikrotikId:  text("mikrotik_id").notNull(),
    profileName: text("profile_name").notNull(),
    updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("profiles_cache_router_mkid").on(t.routerId, t.mikrotikId)],
);

export type ProfilesCache = typeof profilesCacheTable.$inferSelect;
