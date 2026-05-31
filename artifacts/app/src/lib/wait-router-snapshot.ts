import type { PrioritySnapshot } from "@/lib/dashboard-priority";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** Délai avant ping TCP si le snapshot MikroTik n'a pas répondu (préchauffage cache uniquement). */
export const ROUTER_SNAPSHOT_WAIT_MS = 2_000;

/**
 * Attend une réponse `dashboard-priority` (fast+fresh) jusqu’à `timeoutMs`.
 * Timeout ou erreur réseau → `responded: false`.
 */
export async function waitForRouterSnapshot(
  routerId: number,
  timeoutMs = ROUTER_SNAPSHOT_WAIT_MS,
): Promise<{ responded: boolean; snapshot: PrioritySnapshot | null }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(
      `${BASE}/api/routers/${routerId}/dashboard-priority?fast=1&fresh=1`,
      { signal: ac.signal },
    );
    clearTimeout(timer);
    if (!res.ok) return { responded: false, snapshot: null };
    const snapshot = (await res.json()) as PrioritySnapshot;
    return { responded: true, snapshot };
  } catch {
    clearTimeout(timer);
    return { responded: false, snapshot: null };
  }
}
