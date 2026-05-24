import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

/**
 * Modèles de ticket "intégrés" gérés par le super-admin et partagés entre tous les comptes.
 *
 * - Les 3 slugs historiques (`mikhmon-small`, `nanotech-normal`, `nanotech-small`) restent
 *   embarqués côté client comme « factory defaults ». Une ligne en base avec le même `slug`
 *   surcharge ce default (le super-admin a remplacé le modèle d'usine).
 * - Tout slug supplémentaire ajouté ici devient automatiquement une nouvelle entrée du menu
 *   « Modèle intégré » pour tous les comptes.
 *
 * Ce dictionnaire est global (pas de `owner_admin_id`) : la table est volontairement courte
 * et lue par tous les administrateurs/managers connectés.
 */
export const builtinTicketTemplatesTable = pgTable("builtin_ticket_templates", {
  id: serial("id").primaryKey(),
  /** Identifiant stable utilisé comme `presetId` côté UI et en `admin_settings.ticket_template_preset`. */
  slug: text("slug").notNull().unique(),
  /** Libellé affiché dans le menu déroulant « Modèle intégré ». */
  label: text("label").notNull(),
  /** Corps PHP / HTML du modèle (taille raisonnable, ~quelques dizaines de Ko maximum). */
  body: text("body").notNull(),
  /** Ordre d'affichage (croissant). */
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type BuiltinTicketTemplate = typeof builtinTicketTemplatesTable.$inferSelect;
