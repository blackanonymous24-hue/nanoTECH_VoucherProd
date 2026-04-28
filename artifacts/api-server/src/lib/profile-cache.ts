import { listProfiles, type RouterConnection } from "./mikrotik.js";

const PROFILE_CACHE_TTL = 300_000; // 5 min

interface ProfileCacheEntry {
  priceMap: Map<string, string>;
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
    for (const p of profiles) {
      if (p.price) priceMap.set(p.name, p.price);
    }
    profileCache.set(routerId, { priceMap, expiresAt: Date.now() + PROFILE_CACHE_TTL });
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
  conn?: RouterConnection,
): Map<string, string> {
  const cached = profileCache.get(routerId);
  // Background refresh if stale or missing (only if connection info is available)
  if (conn && (!cached || Date.now() >= cached.expiresAt)) {
    void getCachedProfilePrices(routerId, conn).catch(() => {});
  }
  return cached?.priceMap ?? new Map();
}

export function invalidateProfileCache(routerId: number) {
  profileCache.delete(routerId);
}
