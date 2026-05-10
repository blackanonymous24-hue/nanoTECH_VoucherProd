import { sql, eq, asc } from "drizzle-orm";
import { db, presetTemplatesTable, adminSettingsTable } from "@workspace/db";
import { logger } from "./logger.js";
import { getDefaultPresetBodies } from "./preset-default-bodies.js";

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

export async function ensureVendorTicketLetterColumn(): Promise<void> {
  try {
    await db.execute(sql`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS ticket_letter text`);
    logger.info("DB compat: colonne vendors.ticket_letter vérifiée / ajoutée");
  } catch (err) {
    logger.error({ err }, "DB compat: impossible d'ajouter vendors.ticket_letter");
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

/** Anciens corps embarqués ou PHP avec texte figé — plusieurs marqueurs possibles par preset (ex. Mikhmon). */
const LEGACY_PRESET_MARKERS: readonly { name: string; markers: readonly string[] }[] = [
  {
    name: "Modèle de ticket style Mikhmon (85% | 75%)",
    markers: [
      `<table class="voucher" style=" width: 160px;">`,
      `Wi-Fi ABONNEMENT`,
      `07 79 84 43 56`,
    ],
  },
  {
    name: "Modèle de Ticket style nanoTECH (normal) (85% | 85%)",
    markers: [`<!--mks-mulai--><div style="display:inline-block;width:135px`],
  },
  {
    name: "Modèle de Ticket style nanoTECH (petit format) (100% | 75%)",
    markers: [`<!--mks-mulai--><table class="voucher" style="width:100px;font-family:Arial,sans-serif;border-collapse:collapse;"`],
  },
];

export async function ensurePresetTemplatesTable(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS preset_templates (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        html TEXT NOT NULL,
        scale_small INTEGER NOT NULL DEFAULT 85,
        scale_mobile INTEGER NOT NULL DEFAULT 100,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    logger.info("DB compat: table preset_templates vérifiée / créée");
  } catch (err) {
    logger.error({ err }, "DB compat: impossible de créer preset_templates");
  }
}

export async function ensureSelectedPresetIdColumn(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE admin_settings
      ADD COLUMN IF NOT EXISTS selected_preset_id integer
    `);
    logger.info("DB compat: colonne admin_settings.selected_preset_id vérifiée / ajoutée");
  } catch (err) {
    logger.error({ err }, "DB compat: impossible d'ajouter admin_settings.selected_preset_id");
  }
}

export async function seedDefaultPresets(): Promise<void> {
  try {
    const result = await db.execute(sql`SELECT COUNT(*)::int AS count FROM preset_templates`);
    const count = Number((result.rows[0] as { count: string }).count);
    if (count > 0) {
      logger.info({ count }, "DB compat: preset_templates déjà peuplé, seed ignoré");
      return;
    }
    const { mikhmon, nanotechNormal, nanotechSmall } = getDefaultPresetBodies();
    await db.execute(sql`
      INSERT INTO preset_templates (name, html, scale_small, scale_mobile, position)
      VALUES
        ('Modèle de ticket style Mikhmon (85% | 75%)', ${mikhmon}, 85, 75, 0),
        ('Modèle de Ticket style nanoTECH (normal) (85% | 85%)', ${nanotechNormal}, 85, 85, 1),
        ('Modèle de Ticket style nanoTECH (petit format) (100% | 75%)', ${nanotechSmall}, 100, 75, 2)
    `);
    logger.info("DB compat: 3 presets par défaut insérés dans preset_templates");
  } catch (err) {
    logger.error({ err }, "DB compat: erreur lors du seed de preset_templates");
  }
}

/**
 * Remplace les anciens HTML minifiés / simples par les fichiers PHP du dépôt,
 * uniquement si le corps stocké contient encore une portion reconnaissable de l’ancien modèle
 * (ne modifie pas un preset renommé ou fortement personnalisé).
 */
export async function migrateBundledPresetPhpBodies(): Promise<void> {
  const bodies = getDefaultPresetBodies();
  const htmlByName = new Map<string, string>([
    ["Modèle de ticket style Mikhmon (85% | 75%)", bodies.mikhmon],
    ["Modèle de Ticket style nanoTECH (normal) (85% | 85%)", bodies.nanotechNormal],
    ["Modèle de Ticket style nanoTECH (petit format) (100% | 75%)", bodies.nanotechSmall],
  ]);
  try {
    for (const { name, markers } of LEGACY_PRESET_MARKERS) {
      const html = htmlByName.get(name);
      if (!html) continue;
      for (const marker of markers) {
        await db.execute(sql`
          UPDATE preset_templates
          SET html = ${html}, updated_at = NOW()
          WHERE name = ${name} AND strpos(html, ${marker}) > 0
        `);
      }
    }
    logger.info("DB compat: preset_templates — corps PHP nanoTECH/Mikhmon si anciens modèles détectés");
  } catch (err) {
    logger.error({ err }, "DB compat: migrateBundledPresetPhpBodies a échoué");
  }
}

/** Met à jour nom + échelles uniquement pour les anciens libellés seed (sans toucher aux modifs super-admin). */
export async function migrateLegacyPresetTemplateMetadata(): Promise<void> {
  const rows: [string, string, number, number][] = [
    ["Mikhmon", "Modèle de ticket style Mikhmon (85% | 75%)", 85, 75],
    ["nanoTECH (normal)", "Modèle de Ticket style nanoTECH (normal) (85% | 85%)", 85, 85],
    ["nanoTECH (petit format)", "Modèle de Ticket style nanoTECH (petit format) (100% | 75%)", 100, 75],
  ];
  try {
    for (const [oldName, newName, scaleSmall, scaleMobile] of rows) {
      await db
        .update(presetTemplatesTable)
        .set({ name: newName, scaleSmall, scaleMobile })
        .where(eq(presetTemplatesTable.name, oldName));
    }
    logger.info("DB compat: migration des libellés preset legacy (si présents) effectuée");
  } catch (err) {
    logger.error({ err }, "DB compat: migrateLegacyPresetTemplateMetadata a échoué");
  }
}

/** Mikhmon (premier preset par position) par défaut si aucun modèle personnalisé ni sélection. */
export async function backfillDefaultSelectedPresetForAdmins(): Promise<void> {
  try {
    const [first] = await db
      .select({ id: presetTemplatesTable.id })
      .from(presetTemplatesTable)
      .orderBy(asc(presetTemplatesTable.position), asc(presetTemplatesTable.id))
      .limit(1);
    if (!first) return;
    await db.execute(sql`
      UPDATE admin_settings
      SET selected_preset_id = ${first.id}
      WHERE selected_preset_id IS NULL
        AND (ticket_template IS NULL OR TRIM(ticket_template) = '')
    `);
    logger.info("DB compat: selected_preset_id par défaut appliqué aux admins sans template perso");
  } catch (err) {
    logger.error({ err }, "DB compat: backfillDefaultSelectedPresetForAdmins a échoué");
  }
}
