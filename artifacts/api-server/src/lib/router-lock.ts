/**
 * router-lock.ts
 *
 * Per-router exclusive lock for user-initiated MikroTik operations.
 *
 * When a route handler (voucher generation, user add/delete, etc.) acquires
 * the lock for a routerId, background tasks (vendor sync, usage sync) skip
 * that router until the lock is released. User operations from several
 * appareils are NOT mutually exclusive — they share the MikroTik semaphore queue.
 */

const _locked = new Map<number, number>();  // routerId → lock count (reentrant)

export function lockRouter(routerId: number): void {
  _locked.set(routerId, (_locked.get(routerId) ?? 0) + 1);
}

export function unlockRouter(routerId: number): void {
  const n = (_locked.get(routerId) ?? 1) - 1;
  if (n <= 0) _locked.delete(routerId);
  else _locked.set(routerId, n);
}

export function isRouterLocked(routerId: number): boolean {
  return _locked.has(routerId);
}

/**
 * Convenience wrapper: acquire the lock, run fn(), release on completion.
 * Returns the result of fn().
 */
export async function withRouterLock<T>(routerId: number, fn: () => Promise<T>): Promise<T> {
  lockRouter(routerId);
  try {
    return await fn();
  } finally {
    unlockRouter(routerId);
  }
}
