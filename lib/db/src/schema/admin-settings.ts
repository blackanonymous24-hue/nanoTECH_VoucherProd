import { pgTable, serial, text } from "drizzle-orm/pg-core";

export const adminSettingsTable = pgTable("admin_settings", {
  id: serial("id").primaryKey(),
  login: text("login").notNull().default("admin"),
  passwordHash: text("password_hash").notNull(),
});
