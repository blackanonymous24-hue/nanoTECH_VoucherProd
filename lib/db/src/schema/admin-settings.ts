import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";

export const adminSettingsTable = pgTable("admin_settings", {
  id: serial("id").primaryKey(),
  login: text("login").notNull(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name"),
  // Marks the original / root admin who can manage other admins.
  isSuperAdmin: boolean("is_super_admin").notNull().default(false),
  // Soft-disable an admin account (login refused but data preserved).
  isActive: boolean("is_active").notNull().default(true),
  // Subscription window — null means "no active forfait".
  forfaitStartedAt: timestamp("forfait_started_at", { withTimezone: true }),
  forfaitEndsAt: timestamp("forfait_ends_at", { withTimezone: true }),
  // Wallet for buying additional router slots (50 cr = +5 routers).
  credits: integer("credits").notNull().default(0),
  // Number of EXTRA router slots purchased (added on top of the base 5).
  extraRouterSlots: integer("extra_router_slots").notNull().default(0),
  // Template PHP Mikhmon v3 sauvegardé côté serveur pour synchronisation
  // cross-device (mobile, APK, desktop). null = utiliser le template par défaut.
  ticketTemplate: text("ticket_template"),
  printScaleSmall: integer("print_scale_small").notNull().default(100),
  printScaleMobile: integer("print_scale_mobile").notNull().default(100),
  passwordPlain: text("password_plain"),
  verificationCode: text("verification_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AdminSettings = typeof adminSettingsTable.$inferSelect;
