/**
 * Stale-while-revalidate + singleflight pour endpoints MikroTik lourds.
 * 1000 clients sur le même routeur → 1 requête MikroTik / TTL, pas 1000.
 */

type CacheEntry = { data: unknown; exp: number };

const inFlight = new Map<string, Promise<unknown>>();

export function mikCacheGetFresh(store: Map<string, CacheEntry>, key: string): unknown | null {
  const e = store.get(key);
  return e && Date.now() < e.exp ? e.data : null;
}

export function mikCacheGetStale(store: Map<string, CacheEntry>, key: string): unknown | null {
  return store.get(key)?.data ?? null;
}

export function mikCacheSet(store: Map<string, CacheEntry>, key: string, ttl: number, data: unknown): void {
  store.set(key, { data, exp: Date.now() + ttl });
}

/** Répond stale immédiatement ; une seule requête MikroTik en vol par clé. */
export async function mikCacheCoalesce<T>(
  key: string,
  ttl: number,
  store: Map<string, CacheEntry>,
  fetcher: () => Promise<T>,
): Promise<{ data: T; stale: boolean }> {
  const fresh = mikCacheGetFresh(store, key) as T | null;
  if (fresh != null) return { data: fresh, stale: false };

  const stale = mikCacheGetStale(store, key) as T | null;
  const existing = inFlight.get(key) as Promise<T> | undefined;

  if (existing) {
    const data = await existing;
    return { data, stale: stale != null };
  }

  const task = fetcher()
    .then((data) => {
      mikCacheSet(store, key, ttl, data);
      return data;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  if (stale != null) {
    inFlight.set(key, task);
    void task.catch(() => { /* refresh best-effort */ });
    return { data: stale, stale: true };
  }

  inFlight.set(key, task);
  const data = await task;
  return { data, stale: false };
}

/** Lance un refresh SWR sans attendre (endpoint HTTP déjà répondu stale). */
export function mikCacheRefreshBackground<T>(
  key: string,
  ttl: number,
  store: Map<string, CacheEntry>,
  fetcher: () => Promise<T>,
): void {
  if (mikCacheGetFresh(store, key) != null) return;
  if (inFlight.has(key)) return;
  const task = fetcher()
    .then((data) => {
      mikCacheSet(store, key, ttl, data);
      return data;
    })
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, task);
  void task.catch(() => { /* ignore */ });
}
