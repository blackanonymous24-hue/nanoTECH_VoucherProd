import { pgTable, text, serial, timestamp, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const profilesTable = pgTable("profiles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  mikrotikProfile: text("mikrotik_profile"),
  price: real("price").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  speedDownload: integer("speed_download"),
  speedUpload: integer("speed_upload"),
  dataLimitMb: integer("data_limit_mb"),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProfileSchema = createInsertSchema(profilesTable).omit({ id: true, createdAt: true });
export type InsertProfile = z.infer<typeof insertProfileSchema>;
export type Profile = typeof profilesTable.$inferSelect;
