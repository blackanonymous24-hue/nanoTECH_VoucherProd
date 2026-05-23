import type { RouterConnection } from "./mikrotik.js";
import { getRouterInfo } from "./mikrotik.js";

const TTL_MS = 60_000;
const cache = new Map<number, { clock: string | null; exp: number }>();

/** Horloge MikroTik en cache — évite un appel API par requête ventes/classement. */
export async function getRouterClockDateCached(
  routerId: number,
  conn: RouterConnection,
): Promise<string | null> {
  const hit = cache.get(routerId);
  if (hit && Date.now() < hit.exp) return hit.clock;
  try {
    const clock = (await getRouterInfo(conn)).clockDate ?? null;
    cache.set(routerId, { clock, exp: Date.now() + TTL_MS });
    return clock;
  } catch {
    cache.set(routerId, { clock: null, exp: Date.now() + 15_000 });
    return null;
  }
}

export function seedRouterClockDate(routerId: number, clock: string | null | undefined): void {
  if (clock === undefined) return;
  cache.set(routerId, { clock: clock ?? null, exp: Date.now() + TTL_MS });
}
