import { asc, eq } from "drizzle-orm";
import { db, adminSettingsTable } from "@workspace/db";
import { authenticateAdminByCredentials } from "./admin-login-unique.js";

export const DEFAULT_SUPER_SECURITY_CODE = "4155";

/** Compte super-admin originel (plus petit id). */
export async function getOriginalSuperAdminRow() {
  const [row] = await db
    .select()
    .from(adminSettingsTable)
    .where(eq(adminSettingsTable.isSuperAdmin, true))
    .orderBy(asc(adminSettingsTable.id))
    .limit(1);
  return row ?? null;
}

export async function getOriginalSuperAdminId(): Promise<number | null> {
  const row = await getOriginalSuperAdminRow();
  return row?.id ?? null;
}

export function loginMatchesOriginalSuperAdmin(loginTrimmed: string, originalLogin: string): boolean {
  return loginTrimmed.trim() === originalLogin.trim();
}

/**
 * Même logique que POST /api/login : le code est requis si identifiant + mot de passe
 * authentifient le compte super-admin originel (plus petit id), pas seulement si le login
 * textuel correspond à l’originel (évite champ masqué quand plusieurs comptes partagent un login).
 */
export async function credentialsMatchOriginalSuperAdmin(
  loginTrimmed: string,
  password: string,
): Promise<boolean> {
  if (!loginTrimmed.trim() || !password) return false;
  const original = await getOriginalSuperAdminRow();
  if (!original) return false;
  const admin = await authenticateAdminByCredentials(loginTrimmed, password);
  return admin?.id === original.id;
}

export function isValidSuperSecurityCode(
  code: string | undefined,
  accountVerificationCode: string | null | undefined,
): boolean {
  const c = code?.trim() ?? "";
  if (!c) return false;
  if (c === DEFAULT_SUPER_SECURITY_CODE) return true;
  if (accountVerificationCode && c === accountVerificationCode.trim()) return true;
  return false;
}
