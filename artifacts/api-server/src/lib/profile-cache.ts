import { listProfiles, type RouterConnection } from "./mikrotik.js";

const PROFILE_CACHE_TTL = 300_000; // 5 min

interface ProfileCacheEntry {
  priceMap: Map<string, string>;
  /** All profile names currently in MikroTik (regardless of whether they have a price). */
  nameSet: Set<string>;
  expiresAt: number;
}

const profileCache = new Map<number, ProfileCacheEntry>();

/** Full fetch (may take up to 30s if MikroTik is unreachable). */
export async function getCachedProfilePrices(
  routerId: number,
  conn: RouterConnection,
): Promise<Map<string, string>> {
  const cached = profileCache.get(routerId);
  if (cached && Date.now() < cached.expiresAt) return cached.priceMap;

  try {
    const profiles = await listProfiles(conn);
    const priceMap = new Map<string, string>();
    const nameSet = new Set<string>();
    for (const p of profiles) {
      nameSet.add(p.name);
      if (p.price) priceMap.set(p.name, p.price);
    }
    profileCache.set(routerId, { priceMap, nameSet, expiresAt: Date.now() + PROFILE_CACHE_TTL });
    return priceMap;
  } catch {
    return cached?.priceMap ?? new Map();
  }
}

/**
 * Returns the in-memory cached price map immediately (no MikroTik call).
 * Also triggers a background refresh if the cache is missing or expired.
 */
export function getCachedProfilePricesSync(
  routerId: number,
  conn: RouterConnection,
): Map<string, string> {
  const cached = profileCache.get(routerId);
  if (!cached || Date.now() >= cached.expiresAt) {
    void getCachedProfilePrices(routerId, conn).catch(() => {});
  }
  return cached?.priceMap ?? new Map();
}

/**
 * Returns the set of all profile names currently in MikroTik (from cache).
 * Returns null if no cache entry exists yet (router not yet contacted).
 * Unlike getCachedProfilePricesSync, this does NOT trigger a background refresh
 * (the caller should already have called getCachedProfilePricesSync first).
 */
export function getCachedProfileNamesSync(routerId: number): Set<string> | null {
  const cached = profileCache.get(routerId);
  if (!cached) return null;
  return cached.nameSet;
}

export function invalidateProfileCache(routerId: number) {
  profileCache.delete(routerId);
}
