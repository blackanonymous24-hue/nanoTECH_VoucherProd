/**
 * Ordre d’affichage des forfaits (profils hotspot) : identifiant interne RouterOS
 * (champ `mikrotikId`, ex. *1, *2A) croissant — approximation stable de l’ordre
 * de création sur le routeur — puis nom. Doit rester aligné avec
 * `sortHotspotProfilesByCreationOrder` côté API (`mikrotik.ts`).
 */
export function sortRouterProfilesByCreationOrder<T extends { mikrotikId?: string | null; name?: string }>(
  profiles: T[],
): T[] {
  return [...profiles].sort((a, b) => {
    const na = mikrotikRowIdSortKey(a.mikrotikId);
    const nb = mikrotikRowIdSortKey(b.mikrotikId);
    if (na !== nb) return na - nb;
    return String(a.name ?? "").localeCompare(String(b.name ?? ""), "fr", { sensitivity: "base" });
  });
}

function mikrotikRowIdSortKey(id: string | null | undefined): number {
  if (!id || id[0] !== "*") return Number.MAX_SAFE_INTEGER;
  const hex = id.slice(1);
  if (!hex) return Number.MAX_SAFE_INTEGER;
  const n = parseInt(hex, 16);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}
