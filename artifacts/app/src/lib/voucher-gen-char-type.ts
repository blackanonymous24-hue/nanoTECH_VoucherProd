/** Format par défaut (inchangé depuis l’origine de l’app). */
export const DEFAULT_GEN_CHAR_TYPE = "mix" as const;

/** Formats affichés : 3 styles d’origine + abcd (lettres) + 1234 (chiffres). */
export const GEN_CHAR_TYPE_OPTIONS = ["mix", "mix1", "mix2", "lower", "num"] as const;
export type GenCharTypeOption = (typeof GEN_CHAR_TYPE_OPTIONS)[number];

const STORAGE_PREFIX = "vouchernet_gen_char_type";

function storageKey(operatorKey: string): string {
  return `${STORAGE_PREFIX}:${operatorKey.trim().toLowerCase()}`;
}

function isGenCharTypeOption(value: string): value is GenCharTypeOption {
  return (GEN_CHAR_TYPE_OPTIONS as readonly string[]).includes(value);
}

/** Lit le format mémorisé pour cet opérateur (admin / super-admin). */
export function readStoredGenCharType(operatorKey: string | null | undefined): GenCharTypeOption | null {
  if (!operatorKey?.trim()) return null;
  try {
    const key = storageKey(operatorKey);
    const raw =
      localStorage.getItem(key) ??
      sessionStorage.getItem(key);
    if (raw === "mix3") return null;
    if (raw && isGenCharTypeOption(raw)) return raw;
  } catch {
    /* quota / mode privé */
  }
  return null;
}

/** Enregistre le format choisi comme défaut pour cet opérateur. */
export function writeStoredGenCharType(
  operatorKey: string | null | undefined,
  value: GenCharTypeOption,
): void {
  if (!operatorKey?.trim()) return;
  try {
    const key = storageKey(operatorKey);
    localStorage.setItem(key, value);
    sessionStorage.setItem(key, value);
  } catch {
    /* quota / mode privé */
  }
}
