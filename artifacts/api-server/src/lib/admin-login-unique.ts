import { asc, eq } from "drizzle-orm";
import { db, adminSettingsTable } from "@workspace/db";
import { verifyPassword } from "./admin-auth.js";

/** Compte(s) admin avec cet identifiant exact (sensible à la casse). */
export async function findAdminsByLogin(
  loginTrimmed: string,
): Promise<Array<typeof adminSettingsTable.$inferSelect>> {
  const key = loginTrimmed.trim();
  if (!key) return [];
  return db
    .select()
    .from(adminSettingsTable)
    .where(eq(adminSettingsTable.login, key))
    .orderBy(asc(adminSettingsTable.id));
}

/**
 * Authentification admin : identifiant et mot de passe sensibles à la casse.
 * Le mot de passe n'est ni trimé ni normalisé (espaces / majuscules conservés).
 */
export async function authenticateAdminByCredentials(
  loginRaw: string,
  password: string,
): Promise<typeof adminSettingsTable.$inferSelect | null> {
  if (typeof password !== "string" || password.length === 0) return null;
  const loginExact = loginRaw.trim();
  if (!loginExact) return null;

  const rows = await findAdminsByLogin(loginExact);
  for (const admin of rows) {
    if (admin.login !== loginExact) continue;
    if (await verifyPassword(password, admin.passwordHash)) return admin;
  }
  return null;
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
