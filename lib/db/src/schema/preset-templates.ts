import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const presetTemplatesTable = pgTable("preset_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  html: text("html").notNull(),
  scaleSmall: integer("scale_small").notNull().default(85),
  scaleMobile: integer("scale_mobile").notNull().default(100),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type PresetTemplate = typeof presetTemplatesTable.$inferSelect;
