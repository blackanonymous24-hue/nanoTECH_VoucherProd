import { asc, eq } from "drizzle-orm";
import { db, adminSettingsTable } from "@workspace/db";

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
  return loginTrimmed === originalLogin.trim();
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
