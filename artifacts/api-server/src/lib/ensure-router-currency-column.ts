import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger.js";

/**
 * Si le dépôt a été mis à jour (schéma Drizzle + API) sans exécuter la migration
 * SQL sur la base existante, tout SELECT sur `routers.currency` échoue et la
 * liste des routeurs disparaît. Idempotent — aligné sur lib/db/scripts/add-router-currency.sql
 */
export async function ensureRouterCurrencyColumn(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE routers
      ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'FCFA'
    `);
    logger.info("DB compat: colonne routers.currency vérifiée / ajoutée");
  } catch (err) {
    logger.error(
      { err },
      "DB compat: impossible d'ajouter routers.currency — exécutez lib/db/scripts/add-router-currency.sql sur la base",
    );
  }
}

/**
 * Sans cette colonne, tout SELECT Drizzle sur `routers` échoue et la liste des
 * routeurs semble vide. Idempotent — aligné sur lib/db/scripts/add-router-auto-delete-sales-scripts.sql
 */
export async function ensureRouterAutoDeleteSalesScriptsColumn(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE routers
      ADD COLUMN IF NOT EXISTS auto_delete_sales_scripts boolean NOT NULL DEFAULT false
    `);
    logger.info("DB compat: colonne routers.auto_delete_sales_scripts vérifiée / ajoutée");
  } catch (err) {
    logger.error(
      { err },
      "DB compat: impossible d'ajouter routers.auto_delete_sales_scripts — exécutez lib/db/scripts/add-router-auto-delete-sales-scripts.sql",
    );
  }
}

/**
 * Ajoute la colonne ticket_template sur admin_settings si elle n'existe pas.
 * Stocke le template PHP Mikhmon v3 côté serveur pour synchronisation cross-device
 * (mobile web, APK WebView, desktop). null = template par défaut Mikhmon.
 */
export async function ensureTicketTemplateColumn(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE admin_settings
      ADD COLUMN IF NOT EXISTS ticket_template text
    `);
    logger.info("DB compat: colonne admin_settings.ticket_template vérifiée / ajoutée");
  } catch (err) {
    logger.error({ err }, "DB compat: impossible d'ajouter admin_settings.ticket_template");
  }
}

/**
 * Ajoute la colonne password_plain sur admin_settings si elle n'existe pas.
 * Stocke le mot de passe en clair pour affichage dans l'interface super-admin.
 */
export async function ensurePasswordPlainColumn(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE admin_settings
      ADD COLUMN IF NOT EXISTS password_plain text
    `);
    logger.info("DB compat: colonne admin_settings.password_plain vérifiée / ajoutée");
  } catch (err) {
    logger.error({ err }, "DB compat: impossible d'ajouter admin_settings.password_plain");
  }
}

export async function ensureVendorPasswordPlainColumn(): Promise<void> {
  try {
    await db.execute(sql`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS password_plain text`);
    logger.info("DB compat: colonne vendors.password_plain vérifiée / ajoutée");
  } catch (err) {
    logger.error({ err }, "DB compat: impossible d'ajouter vendors.password_plain");
  }
}

export async function ensureManagerPasswordPlainColumn(): Promise<void> {
  try {
    await db.execute(sql`ALTER TABLE managers ADD COLUMN IF NOT EXISTS password_plain text`);
    logger.info("DB compat: colonne managers.password_plain vérifiée / ajoutée");
  } catch (err) {
    logger.error({ err }, "DB compat: impossible d'ajouter managers.password_plain");
  }
}

export async function ensureCollaborateurPasswordPlainColumn(): Promise<void> {
  try {
    await db.execute(sql`ALTER TABLE collaborateurs ADD COLUMN IF NOT EXISTS password_plain text`);
    logger.info("DB compat: colonne collaborateurs.password_plain vérifiée / ajoutée");
  } catch (err) {
    logger.error({ err }, "DB compat: impossible d'ajouter collaborateurs.password_plain");
  }
}

export async function ensureVerificationCodeColumn(): Promise<void> {
  try {
    await db.execute(sql`ALTER TABLE admin_settings ADD COLUMN IF NOT EXISTS verification_code text`);
    logger.info("DB compat: colonne admin_settings.verification_code vérifiée / ajoutée");
  } catch (err) {
    logger.error({ err }, "DB compat: impossible d'ajouter admin_settings.verification_code");
  }
}

/**
 * Backfill password_plain = 'root' pour les super admins créés avant l'ajout
 * de la colonne (le compte initial admin/root n'avait pas de mot de passe en clair stocké).
 * Idempotent : ne touche que les lignes où password_plain IS NULL.
 */
export async function ensureSuperAdminPasswordPlainBackfill(): Promise<void> {
  try {
    const result = await db.execute(sql`
      UPDATE admin_settings
      SET password_plain = 'root'
      WHERE is_super_admin = true
        AND password_plain IS NULL
    `);
    const count = (result as unknown as { rowCount: number }).rowCount ?? 0;
    if (count > 0) {
      logger.info({ count }, "DB compat: backfill password_plain='root' pour super admin(s) initial");
    }
  } catch (err) {
    logger.error({ err }, "DB compat: backfill password_plain super admin échoué");
  }
}
