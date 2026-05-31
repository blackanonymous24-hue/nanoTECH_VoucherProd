import type { PrioritySnapshot } from "@/lib/dashboard-priority";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** Attend une réponse `dashboard-priority` bloquante (fresh+wait MikroTik). */
export async function waitForRouterSnapshot(
  routerId: number,
  timeoutMs = 30_000,
): Promise<{ responded: boolean; snapshot: PrioritySnapshot | null }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(
      `${BASE}/api/routers/${routerId}/dashboard-priority?fast=1&fresh=1&wait=1`,
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
