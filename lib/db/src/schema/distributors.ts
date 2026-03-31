import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const distributorsTable = pgTable("distributors", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  pin: text("pin"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDistributorSchema = createInsertSchema(distributorsTable).omit({ id: true, createdAt: true });
export type InsertDistributor = z.infer<typeof insertDistributorSchema>;
export type Distributor = typeof distributorsTable.$inferSelect;
