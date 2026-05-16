/** Dernier lot imprimé sur Mes tickets (par routeur) — utilisé après impression et pour nettoyage à la suppression de lot. */
const KEY_PREFIX = "vouchernet_print_lot_v1";

export type SavedPrintLot = {
  routerId: number;
  comment: string;
  profile?: string | null;
  savedAt: string;
};

export function savedPrintLotStorageKey(routerId: number): string {
  return `${KEY_PREFIX}:${routerId}`;
}

export function loadSavedPrintLot(routerId: number | null | undefined): SavedPrintLot | null {
  if (!routerId) return null;
  try {
    const raw = localStorage.getItem(savedPrintLotStorageKey(routerId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedPrintLot;
    if (!parsed?.comment?.trim() || parsed.routerId !== routerId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSavedPrintLot(
  routerId: number,
  comment: string,
  profile?: string | null,
): void {
  const c = comment.trim();
  if (!routerId || !c) return;
  try {
    const payload: SavedPrintLot = {
      routerId,
      comment: c,
      profile: profile ?? null,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(savedPrintLotStorageKey(routerId), JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export function clearAllSavedPrintLots(): void {
  try {
    const prefix = `${KEY_PREFIX}:`;
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(prefix)) toRemove.push(k);
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

export function clearSavedPrintLot(routerId: number | null | undefined): void {
  if (!routerId) return;
  try {
    localStorage.removeItem(savedPrintLotStorageKey(routerId));
  } catch {
    /* ignore */
  }
}
