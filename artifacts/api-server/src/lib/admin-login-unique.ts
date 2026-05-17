import { sql } from "drizzle-orm";
import { db, adminSettingsTable } from "@workspace/db";
import { verifyPassword } from "./admin-auth.js";

/** Tous les comptes admin avec cet identifiant (insensible à la casse). */
export async function findAdminsByLogin(
  loginTrimmed: string,
): Promise<Array<typeof adminSettingsTable.$inferSelect>> {
  const key = loginTrimmed.trim().toLowerCase();
  if (!key) return [];
  return db
    .select()
    .from(adminSettingsTable)
    .where(sql`lower(${adminSettingsTable.login}) = ${key}`);
}

/**
 * Autre compte (hors excludeAdminId) avec le même identifiant ET le même mot de passe.
 * Même identifiant + mot de passe différent → autorisé.
 */
export async function findAdminLoginPasswordCollision(
  loginTrimmed: string,
  password: string,
  excludeAdminId?: number,
): Promise<typeof adminSettingsTable.$inferSelect | null> {
  const rows = await findAdminsByLogin(loginTrimmed);
  for (const row of rows) {
    if (excludeAdminId != null && row.id === excludeAdminId) continue;
    if (await verifyPassword(password, row.passwordHash)) return row;
  }
  return null;
}

/** Collision sur hash stocké (ex. changement d’identifiant sans changer le mot de passe). */
export async function findAdminLoginPasswordHashCollision(
  loginTrimmed: string,
  passwordHash: string,
  excludeAdminId: number,
): Promise<typeof adminSettingsTable.$inferSelect | null> {
  const rows = await findAdminsByLogin(loginTrimmed);
  for (const row of rows) {
    if (row.id === excludeAdminId) continue;
    if (row.passwordHash === passwordHash) return row;
  }
  return null;
}

export async function adminLoginPasswordCollisionMessage(
  loginTrimmed: string,
  password: string,
  excludeAdminId?: number,
): Promise<string | null> {
  const hit = await findAdminLoginPasswordCollision(loginTrimmed, password, excludeAdminId);
  if (!hit) return null;
  const kind = hit.isSuperAdmin ? "super administrateur" : "administrateur";
  return `Un compte ${kind} utilise déjà cet identifiant avec le même mot de passe. Choisissez un autre mot de passe.`;
}
