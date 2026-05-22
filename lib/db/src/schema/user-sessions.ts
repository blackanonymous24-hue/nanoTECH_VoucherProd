import { pgTable, serial, text, integer, timestamp, uuid } from "drizzle-orm/pg-core";
import { adminSettingsTable } from "./admin-settings.js";
import { vendorsTable } from "./vendors.js";
import { managersTable } from "./managers.js";
import { collaborateursTable } from "./collaborateurs.js";

/**
 * Sessions actives par appareil.
 * Permet la déconnexion sélective : logout sur appareil A n'affecte pas appareil B.
 */
export const userSessionsTable = pgTable("user_sessions", {
  id: serial("id").primaryKey(),
  /** UUID unique généré à la connexion, embarqué dans le token. */
  sessionId: uuid("session_id").notNull(),
  /** Type d'utilisateur propriétaire de cette session. */
  userType: text("user_type").notNull(), // 'admin' | 'vendor' | 'manager' | 'collaborateur'
  /** ID de l'utilisateur dans sa table respective. */
  userId: integer("user_id").notNull(),
  /** Label de l'appareil (navigateur + OS approximatif). */
  deviceLabel: text("device_label"),
  /** Date de création de la session. */
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** Dernière activité (mise à jour à chaque requête API). */
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserSession = typeof userSessionsTable.$inferSelect;
export type NewUserSession = typeof userSessionsTable.$inferInsert;
