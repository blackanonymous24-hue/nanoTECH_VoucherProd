/**
 * Repair one-shot des chaînes mojibakées stockées en DB avant le fix
 * d'encodage côté ingestion (`decodeRouterText` ajouté dans `fetchScriptSales`
 * et `fetchSaleDetails`).
 *
 * Cibles : `mikrotik_script_sales` (username/label/batch/validity) et
 * `vouchers` (username/comment/profile_name).
 *
 * Critère de sélection : lignes dont la chaîne contient un marqueur typique
 * de mojibake UTF-8-lu-en-latin1 — soit la séquence `Ã` (0xC3) suivie d'un
 * octet 0x80-0xBF, soit `â€` (0xE2 0x80) — pour éviter de toucher l'immense
 * majorité des lignes ASCII.
 *
 * `decodeRouterText` étant idempotent, ré-écrire les lignes même multiple fois
 * ne casse rien ; on filtre juste pour minimiser l'I/O.
 *
 * Cette fonction est appelée UNE fois au démarrage, en arrière-plan, et logue
 * le nombre de lignes corrigées. Si elle échoue, le service démarre quand même.
 */
import { eq, or, sql } from "drizzle-orm";
import { db, scriptSalesTable, vouchersTable } from "@workspace/db";
import { decodeRouterText } from "./router-encoding.js";
import { logger } from "./logger.js";

/** Détecte les marqueurs typiques de mojibake UTF-8→latin1. */
function isMojibake(s: string | null | undefined): boolean {
  if (!s) return false;
  // C3 suivi de 80–BF (séquence UTF-8 de 2 octets lus comme latin1) → "Ã<x>"
  // E2 80 (début d'une séquence UTF-8 de 3 octets : punctuation) → "â€"
  // C2 suivi de 80–BF → "Â<x>"
  return /[\u00C2\u00C3][\u0080-\u00BF]|\u00E2\u0080/.test(s);
}

async function repairScriptSales(): Promise<number> {
  // ILIKE est rapide ici : on cible une fraction minime des lignes.
  const candidates = await db
    .select({
      id: scriptSalesTable.id,
      username: scriptSalesTable.username,
      label: scriptSalesTable.label,
      batch: scriptSalesTable.batch,
      validity: scriptSalesTable.validity,
    })
    .from(scriptSalesTable)
    .where(or(
      sql`${scriptSalesTable.username} ~ E'[\\xC2\\xC3][\\x80-\\xBF]|\\xE2\\x80'`,
      sql`${scriptSalesTable.label}    ~ E'[\\xC2\\xC3][\\x80-\\xBF]|\\xE2\\x80'`,
      sql`${scriptSalesTable.batch}    ~ E'[\\xC2\\xC3][\\x80-\\xBF]|\\xE2\\x80'`,
      sql`${scriptSalesTable.validity} ~ E'[\\xC2\\xC3][\\x80-\\xBF]|\\xE2\\x80'`,
    ))
    .limit(50_000);

  let updated = 0;
  for (const row of candidates) {
    const newUsername = decodeRouterText(row.username);
    const newLabel    = decodeRouterText(row.label);
    const newBatch    = decodeRouterText(row.batch);
    const newValidity = decodeRouterText(row.validity);
    if (
      newUsername === row.username &&
      newLabel    === row.label &&
      newBatch    === row.batch &&
      newValidity === row.validity
    ) continue;
    try {
      await db.update(scriptSalesTable)
        .set({ username: newUsername, label: newLabel, batch: newBatch, validity: newValidity })
        .where(eq(scriptSalesTable.id, row.id));
      updated++;
    } catch {
      // Collision possible sur l'index unique (router_id, raw_name) — on ignore.
    }
  }
  return updated;
}

async function repairVouchers(): Promise<number> {
  const candidates = await db
    .select({
      id: vouchersTable.id,
      username: vouchersTable.username,
      comment: vouchersTable.comment,
      profileName: vouchersTable.profileName,
    })
    .from(vouchersTable)
    .where(or(
      sql`${vouchersTable.username}     ~ E'[\\xC2\\xC3][\\x80-\\xBF]|\\xE2\\x80'`,
      sql`${vouchersTable.comment}      ~ E'[\\xC2\\xC3][\\x80-\\xBF]|\\xE2\\x80'`,
      sql`${vouchersTable.profileName}  ~ E'[\\xC2\\xC3][\\x80-\\xBF]|\\xE2\\x80'`,
    ))
    .limit(50_000);

  let updated = 0;
  for (const row of candidates) {
    const newUsername    = decodeRouterText(row.username);
    const newComment     = row.comment == null ? null : decodeRouterText(row.comment);
    const newProfileName = decodeRouterText(row.profileName);
    if (
      newUsername    === row.username &&
      newComment     === row.comment &&
      newProfileName === row.profileName
    ) continue;
    try {
      await db.update(vouchersTable)
        .set({ username: newUsername, comment: newComment, profileName: newProfileName })
        .where(eq(vouchersTable.id, row.id));
      updated++;
    } catch {
      // Voucher username unique sur (router_id, username) — collision possible si
      // deux lignes mojibakées différemment décodent vers la même chaîne. On ignore.
    }
  }
  return updated;
}

/**
 * Appelé une seule fois au démarrage du serveur, en arrière-plan (non-bloquant).
 */
export async function repairMojibakeOnce(): Promise<void> {
  try {
    const [scriptCount, voucherCount] = await Promise.all([
      repairScriptSales(),
      repairVouchers(),
    ]);
    if (scriptCount > 0 || voucherCount > 0) {
      logger.info({ scriptCount, voucherCount }, "mojibake repaired in DB");
    }
  } catch (err) {
    logger.warn({ err }, "mojibake repair failed (non-fatal)");
  }
}
