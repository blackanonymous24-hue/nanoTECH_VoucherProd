/** Lot choisi pour l’impression sur Mes tickets — par routeur. */
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

export function clearSavedPrintLot(routerId: number | null | undefined): void {
  if (!routerId) return;
  try {
    localStorage.removeItem(savedPrintLotStorageKey(routerId));
  } catch {
    /* ignore */
  }
}
