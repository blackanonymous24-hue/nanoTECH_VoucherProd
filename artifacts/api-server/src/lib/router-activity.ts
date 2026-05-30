/** Dernière activité HTTP par routeur — évite sync MikroTik sur routeurs non consultés. */
const lastRouterActivityAt = new Map<number, number>();
export const ROUTER_IDLE_MS = 5 * 60_000;

export function markRouterActive(routerId: number): void {
  lastRouterActivityAt.set(routerId, Date.now());
}

export function isRouterRecentlyActive(routerId: number, maxIdleMs = ROUTER_IDLE_MS): boolean {
  const last = lastRouterActivityAt.get(routerId) ?? 0;
  return Date.now() - last <= maxIdleMs;
}
