import { sql, eq, asc } from "drizzle-orm";
import { db, presetTemplatesTable, adminSettingsTable } from "@workspace/db";
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

const MIKHMON_HTML = `<table class="voucher" style=" width: 160px;">
  <tbody>
    <tr>
      <td style="text-align: left; font-size: 14px; font-weight:bold; border-bottom: 1px black solid;"><?= $hotspotname; ?><span id="num"><?= " [$num]"; ?></span></td>
    </tr>
    <tr>
      <td>
    <table style=" text-align: center; width: 150px;">
  <tbody>
    <tr style="color: black; font-size: 11px;">
      <td>
        <table style="width:100%;">
<!-- Username = Password    -->
<?php if ($usermode == "vc") { ?>
        <tr>
          <td >Code ticket</td>
        </tr>
        <tr style="color: black; font-size: 14px;">
          <td style="width:100%; border: 1px solid black; font-weight:bold;"><?= $username; ?></td>
        </tr>
        <tr>
          <td colspan="2" style="border: 1px solid black; font-weight:bold;"><?= $validity; ?> <?= $timelimit; ?> <?= $datalimit; ?> <?= $price; ?></td>
        </tr>
<!-- /  -->
<!-- Username & Password  -->
<?php 
} elseif ($usermode == "up") { ?>
          <tr>
          <td style="width: 50%">Username</td>
          <td>Password</td>
        </tr>
        <tr style="color: black; font-size: 14px;">
          <td style="border: 1px solid black; font-weight:bold;"><?= $username; ?></td>
          <td style="border: 1px solid black; font-weight:bold;"><?= $password; ?></td>
        </tr>
        <tr>
          <td colspan="2" style="border: 1px solid black; font-weight:bold;"><?= $validity; ?> <?= $timelimit; ?> <?= $datalimit; ?> <?= $price; ?></td>
        </tr>
<?php 
} ?>
<!-- /  -->
        </table>
      </td>
    </tr>
  </tbody>
    </table>
      </td>
    </tr>
  </tbody>
</table>`;

const NANOTECH_NORMAL_HTML = `<!--mks-mulai--><div style="display:inline-block;width:135px;overflow:hidden;position:relative;"><table class="voucher" style="border-collapse:collapse;border:1px solid #444;margin:0;width:135px;font-family:Arial,sans-serif;vertical-align:top;"><tbody><tr><td style="background:<?= $color;?>;padding:0;" colspan="2"><div style="text-align:center;color:#fff;font-size:8px;font-weight:bold;padding:2.5px;"><b><?= $hotspotname;?></b></div></td></tr><tr><td style="color:#666;" valign="top"><table style="width:100%;"><tbody><tr><td style="width:35px;"><div style="position:relative;z-index:-1;padding:0;"><div style="position:absolute;top:0;margin-top:-100px;width:0;height:0;border-top:170px solid transparent;border-left:30px solid transparent;border-right:170px solid #DCDCDC;"></div></div></td><td><div style="margin:-10px;text-align:right;font-weight:bold;font-size:10px;color:<?= $color;?>;"><small style="font-size:10px;margin-left:-65px;position:absolute;"><?= $getprice;?> <?= $currency;?></small></div></td></tr></tbody></table></td></tr><tr><td style="color:#666;border-collapse:collapse;" valign="top"><table style="width:100%;border-collapse:collapse;"><tbody><tr><td style="width:80px;" valign="top"><div style="clear:both;color:#555;margin-top:-7px;margin-bottom:2.5px;"><?php if($usermode=="vc"){?><div style="border-bottom:1px solid;text-align:center;font-weight:bold;font-size:9px;color:#444;">Code Ticket</div><div style="border-bottom:1px solid;text-align:center;font-weight:bold;font-size:12px;color:<?= $color;?>;"><?= $username;?></div><?php }elseif($usermode=="up"){?><div style="border-bottom:1px solid;text-align:center;font-weight:bold;font-size:9px;color:#444;">Compte</div><div style="border-bottom:1px solid;text-align:center;font-weight:bold;font-size:10px;color:<?= $color;?>;"><?= $username;?><br><?= $password;?></div><?php }?></div><div style="text-align:center;color:#111;font-size:5.5px;font-weight:bold;padding:2.5px;">Veuillez conserver ce ticket. Aucune reclamation sans ce bon d'achat.</div></td><td style="text-align:right;" valign="top"><div style="padding:0 2px;font-size:7px;font-weight:bold;color:#000;"><?= $validity;?><br><?= $timelimit;?><br><?= $datalimit;?></div><img style="border:1px <?= $color;?> solid;border-radius:3px;width:32px;height:32px;display:inline-block;margin:0 1px -5px 0;vertical-align:bottom;" src="<?= $qrcode;?>" alt="QR"/></td></tr><tr><td style="background:<?= $color;?>;padding:0;" colspan="2"><div style="display:table;width:100%;color:#fff;font-size:6px;font-weight:bold;padding:2.5px;"><b style="display:table-cell;text-align:left;"><?= $dnsname;?></b><span style="display:table-cell;text-align:right;white-space:nowrap;">[<?= $num;?>]</span></div></td></tr></tbody></table></td></tr></tbody></table></div><!--mks-akhir-->`;

const NANOTECH_SMALL_HTML = `<!--mks-mulai--><table class="voucher" style="width:100px;font-family:Arial,sans-serif;border-collapse:collapse;"><tbody><tr><td style="background:<?= $color;?>;color:#fff;font-size:7px;font-weight:bold;padding:1px 3px;text-align:center;" colspan="2"><b><?= $hotspotname;?></b> . <?= $getprice;?> <?= $currency;?></td></tr><tr><td valign="top" style="padding:2px;"><?php if($usermode=="vc"){?><div style="border:1px solid <?= $color;?>;text-align:center;font-weight:bold;font-size:9px;color:<?= $color;?>;padding:1px;"><?= $username;?></div><?php }elseif($usermode=="up"){?><div style="border:1px solid <?= $color;?>;text-align:center;font-size:7px;padding:1px;"><b style="font-size:9px;color:<?= $color;?>;"><?= $username;?></b><br>PW: <?= $password;?></div><?php }?><div style="font-size:5.5px;color:#555;margin-top:1px;"><?= $validity;?> <?= $timelimit;?></div></td><td valign="top" style="padding:2px;text-align:right;"><img src="<?= $qrcode;?>" style="width:28px;height:28px;" alt="QR"/></td></tr><tr><td style="background:<?= $color;?>;color:#fff;font-size:5px;padding:1px 3px;" colspan="2"><?= $dnsname;?> <span style="float:right;">[<?= $num;?>]</span></td></tr></tbody></table><!--mks-akhir-->`;

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
    await db.execute(sql`
      INSERT INTO preset_templates (name, html, scale_small, scale_mobile, position)
      VALUES
        ('Modèle de ticket style Mikhmon (85% | 75%)', ${MIKHMON_HTML}, 85, 75, 0),
        ('Modèle de Ticket style nanoTECH (normal) (85% | 85%)', ${NANOTECH_NORMAL_HTML}, 85, 85, 1),
        ('Modèle de Ticket style nanoTECH (petit format) (100% | 75%)', ${NANOTECH_SMALL_HTML}, 100, 75, 2)
    `);
    logger.info("DB compat: 3 presets par défaut insérés dans preset_templates");
  } catch (err) {
    logger.error({ err }, "DB compat: erreur lors du seed de preset_templates");
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
