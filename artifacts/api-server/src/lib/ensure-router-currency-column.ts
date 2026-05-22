import { sql, eq } from "drizzle-orm";
import { db, routersTable } from "@workspace/db";
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
 * Supprime les colonnes legacy d’échelle d’impression (non utilisées). Ne touche pas à
 * `ticket_template` (modèle Mikhmon / page « Modèle de ticket »).
 */
export async function ensureDropAdminSettingsVoucherPrintColumns(): Promise<void> {
  try {
    await db.execute(sql`ALTER TABLE admin_settings DROP COLUMN IF EXISTS print_scale_small`);
    await db.execute(sql`ALTER TABLE admin_settings DROP COLUMN IF EXISTS print_scale_mobile`);
    logger.info("DB compat: colonnes admin_settings.print_scale_* retirées si présentes");
  } catch (err) {
    logger.error({ err }, "DB compat: impossible de retirer admin_settings.print_scale_*");
  }
}

/**
 * Colonne `ticket_template` pour la page Modèle de ticket (sync serveur).
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

/** Preset ticket (mikhmon / nanotech) — requis pour POST /api/login (SELECT admin_settings). */
export async function ensureTicketTemplatePresetColumn(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE admin_settings
      ADD COLUMN IF NOT EXISTS ticket_template_preset text
    `);
    logger.info("DB compat: colonne admin_settings.ticket_template_preset vérifiée / ajoutée");
  } catch (err) {
    logger.error(
      { err },
      "DB compat: impossible d'ajouter admin_settings.ticket_template_preset — exécutez lib/db/scripts/add-ticket-template-preset.sql",
    );
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

export async function ensureVendorTicketLetterColumn(): Promise<void> {
  try {
    await db.execute(sql`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS ticket_letter text`);
    logger.info("DB compat: colonne vendors.ticket_letter vérifiée / ajoutée");
  } catch (err) {
    logger.error({ err }, "DB compat: impossible d'ajouter vendors.ticket_letter");
  }
}

export async function ensureVendorSettlementModeColumn(): Promise<void> {
  try {
    await db.execute(sql`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS settlement_mode text NOT NULL DEFAULT 'daily'`);
    await db.execute(sql`UPDATE vendors SET settlement_mode = 'daily' WHERE settlement_mode IS NULL OR settlement_mode = ''`);
    logger.info("DB compat: colonne vendors.settlement_mode vérifiée / ajoutée");
  } catch (err) {
    logger.error({ err }, "DB compat: impossible d'ajouter vendors.settlement_mode");
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
 * Colonnes print_scale_web / print_scale_mobile (0–100) — legacy, conservées.
 * Colonne print_scales (JSON per-template) — version actuelle.
 */
export async function ensurePrintScaleColumns(): Promise<void> {
  try {
    await db.execute(sql`ALTER TABLE admin_settings ADD COLUMN IF NOT EXISTS print_scale_web integer`);
    await db.execute(sql`ALTER TABLE admin_settings ADD COLUMN IF NOT EXISTS print_scale_mobile integer`);
    await db.execute(sql`ALTER TABLE admin_settings ADD COLUMN IF NOT EXISTS print_scales text`);
    logger.info("DB compat: colonnes admin_settings.print_scale_web/mobile/scales vérifiées / ajoutées");
  } catch (err) {
    logger.error({ err }, "DB compat: impossible d'ajouter admin_settings.print_scale*");
  }
}

/** Port API RouterOS exposé par les gateways VPN Mikhmon (TCP joignable depuis le VPS). */
export const MIKHMON_VPN_GATEWAY_API_PORT = 2520;

/**
 * Sans cette colonne, tout SELECT Drizzle sur `routers` échoue en production.
 * Aligné sur lib/db/scripts/add-router-timezone-offset.sql
 */
export async function ensureRouterTimezoneOffsetColumn(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE routers
      ADD COLUMN IF NOT EXISTS timezone_offset_minutes integer NOT NULL DEFAULT 0
    `);
    logger.info("DB compat: colonne routers.timezone_offset_minutes vérifiée / ajoutée");
  } catch (err) {
    logger.error(
      { err },
      "DB compat: impossible d'ajouter routers.timezone_offset_minutes — exécutez lib/db/scripts/add-router-timezone-offset.sql",
    );
  }
}

/**
 * Corrige les routeurs VPN enregistrés avec le port par défaut 8728 alors que le gateway
 * expose l'API sur 2520 (confirmé par test TCP depuis le VPS).
 */
export async function repairVpnGatewayRouterPorts(): Promise<void> {
  try {
    const result = await db.execute(sql`
      UPDATE routers
      SET port = ${MIKHMON_VPN_GATEWAY_API_PORT}
      WHERE port = 8728
        AND (
          host LIKE '%.mikroot.com'
          OR host IN ('vpn.nanotechvpn.com', 'vpn.wifi225.com')
        )
    `);
    const count = (result as unknown as { rowCount?: number }).rowCount ?? 0;
    if (count > 0) {
      logger.info({ count, port: MIKHMON_VPN_GATEWAY_API_PORT }, "DB compat: ports gateway VPN corrigés (8728 → 2520)");
    }
  } catch (err) {
    logger.error({ err }, "DB compat: correction ports gateway VPN échouée");
  }
}

/** Corrige uniquement `host` contenant `:port` (ne modifie jamais le port si host est déjà nu). */
export async function normalizeStoredRouterHosts(): Promise<void> {
  try {
    const rows = await db.select({ id: routersTable.id, host: routersTable.host, port: routersTable.port }).from(routersTable);
    let fixed = 0;
    for (const r of rows) {
      const h = r.host.trim();
      const colonIdx = h.lastIndexOf(":");
      if (colonIdx <= 0) continue;
      const portStr = h.slice(colonIdx + 1);
      if (!/^\d+$/.test(portStr)) continue;
      const parsedPort = parseInt(portStr, 10);
      if (parsedPort < 1 || parsedPort > 65535) continue;
      const hostOnly = h.slice(0, colonIdx).trim();
      if (!hostOnly) continue;
      if (hostOnly === h && parsedPort === r.port) continue;
      await db.update(routersTable).set({ host: hostOnly, port: parsedPort }).where(eq(routersTable.id, r.id));
      fixed++;
    }
    if (fixed > 0) {
      logger.info({ fixed }, "DB compat: host « ip:port » scindé en host + port");
    }
  } catch (err) {
    logger.error({ err }, "DB compat: normalisation host/port routeurs échouée");
  }
}

export async function ensureUserSessionsTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id serial PRIMARY KEY,
        session_id uuid NOT NULL UNIQUE,
        user_type text NOT NULL,
        user_id integer NOT NULL,
        device_label text,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_active_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_user_sessions_session_id ON user_sessions (session_id)
    `);
    await db.execute(sql`
      ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS persistent boolean NOT NULL DEFAULT false
    `);
    logger.info("DB compat: table user_sessions vérifiée / ajoutée");
  } catch (err) {
    logger.error({ err }, "DB compat: impossible de créer user_sessions");
  }
}

/**
 * Colonne session_epoch — invalidation globale (anciens jetons sans session_id uniquement).
 */
export async function ensureSessionEpochColumns(): Promise<void> {
  try {
    await db.execute(sql`ALTER TABLE admin_settings ADD COLUMN IF NOT EXISTS session_epoch integer NOT NULL DEFAULT 0`);
    await db.execute(sql`ALTER TABLE vendors        ADD COLUMN IF NOT EXISTS session_epoch integer NOT NULL DEFAULT 0`);
    await db.execute(sql`ALTER TABLE managers       ADD COLUMN IF NOT EXISTS session_epoch integer NOT NULL DEFAULT 0`);
    await db.execute(sql`ALTER TABLE collaborateurs ADD COLUMN IF NOT EXISTS session_epoch integer NOT NULL DEFAULT 0`);
    logger.info("DB compat: colonne session_epoch vérifiée / ajoutée (admin_settings, vendors, managers, collaborateurs)");
  } catch (err) {
    logger.error({ err }, "DB compat: impossible d'ajouter session_epoch");
  }
}

/**
 * Backfill password_plain = 'root' pour les super admins créés avant l'ajout
 * de la colonne (le compte initial admin/root n'avait pas de mot de passe en clair stocké).
 * Idempotent : ne touche que les lignes où password_plain IS NULL.
 */
/** Table d’association gérant ↔ routeurs (1 ou plusieurs routeurs par gérant). */
export async function ensureManagerRoutersTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS manager_routers (
        manager_id integer NOT NULL REFERENCES managers(id) ON DELETE CASCADE,
        router_id integer NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
        PRIMARY KEY (manager_id, router_id)
      )
    `);
    await db.execute(sql`
      INSERT INTO manager_routers (manager_id, router_id)
      SELECT id, router_id FROM managers
      WHERE router_id IS NOT NULL
      ON CONFLICT DO NOTHING
    `);
    logger.info("DB compat: table manager_routers vérifiée / backfill depuis managers.router_id");
  } catch (err) {
    logger.error({ err }, "DB compat: impossible de créer manager_routers");
  }
}

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
