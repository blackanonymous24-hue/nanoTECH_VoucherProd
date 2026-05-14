import type { HotspotProfile } from "@workspace/api-client-react";
import { getListRouterProfilesQueryKey } from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";
import { sortRouterProfilesByCreationOrder } from "@/lib/routerProfilesSort";

/**
 * Profils hotspot **après** aller-retour MikroTik (prix / sellingPrice à jour).
 * Le GET classique renvoie souvent le cache RAM sans attendre le routeur.
 */
export async function fetchRouterProfilesAwaitLive(
  apiBase: string,
  routerId: number,
): Promise<HotspotProfile[]> {
  const res = await fetch(`${apiBase}/api/routers/${routerId}/profiles?awaitLive=1`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];
  return data as HotspotProfile[];
}

/** GET `/profiles` sans `awaitLive` : cache serveur / snapshot, rapide pour l’impression. */
export async function fetchProfilesSnap(
  apiBase: string,
  routerId: number,
): Promise<HotspotProfile[]> {
  const res = await fetch(`${apiBase}/api/routers/${routerId}/profiles`, { cache: "no-store" });
  if (!res.ok) return [];
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];
  return data as HotspotProfile[];
}

function snapCoversUserProfiles(
  users: Array<{ profile?: string | null }>,
  snap: HotspotProfile[],
): boolean {
  if (snap.length === 0) return false;
  const names = new Set(
    snap.map((p) => String(p.name ?? "").trim()).filter(Boolean),
  );
  for (const u of users) {
    const profile = String(u.profile ?? "").trim();
    if (profile && !names.has(profile)) return false;
  }
  return true;
}

/**
 * Pour l’impression : si le snapshot couvre tous les profils des vouchers, on évite
 * `awaitLive` (latence MikroTik). Sinon on recharge en live pour prix / lignes à jour.
 */
export async function finalizeProfilesForPrint(
  apiBase: string,
  routerId: number,
  fallback: HotspotProfile[],
  users: Array<{ profile?: string | null }>,
  profilesSnap: HotspotProfile[],
): Promise<HotspotProfile[]> {
  if (snapCoversUserProfiles(users, profilesSnap)) {
    const sorted = sortRouterProfilesByCreationOrder(profilesSnap);
    queryClient.setQueryData(getListRouterProfilesQueryKey(routerId), profilesSnap);
    return sorted;
  }
  try {
    const live = await fetchRouterProfilesAwaitLive(apiBase, routerId);
    if (live.length > 0) {
      queryClient.setQueryData(getListRouterProfilesQueryKey(routerId), live);
      return sortRouterProfilesByCreationOrder(live);
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

/** @deprecated Préférer `finalizeProfilesForPrint` avec users + snap issus d’un `Promise.all`. */
export async function loadSortedProfilesForPrint(
  apiBase: string,
  routerId: number,
  fallback: HotspotProfile[],
): Promise<HotspotProfile[]> {
  return finalizeProfilesForPrint(apiBase, routerId, fallback, [], []);
}
