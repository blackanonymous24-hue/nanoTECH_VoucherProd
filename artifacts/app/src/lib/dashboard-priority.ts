/** Types partagés — flux SSE `GET /routers/:id/dashboard-priority/stream`. */

export interface SalesLite {
  dailyCount: number;
  dailyAmount: number;
  monthlyCount: number;
  monthlyAmount: number;
  _cachedAt: number | null;
}

export interface VendorRankingRow {
  vendorId: number;
  name: string;
  dailySold: number;
  monthlySold: number;
}

/** Classement : ventes sans identifiant vendeur (`vendorId === 0`). */
export const UNATTRIBUTED_VENDOR_ID = 0;

export interface PrioritySnapshot {
  serverTs: number;
  sessionsCount: number;
  users: { total: number; available: number; used: number; disabled: number; cachedAt: number | null };
  sales: SalesLite;
  vendorRanking?: VendorRankingRow[] | null;
  info: unknown;
  availability?: {
    sessionsKnown?: boolean;
    usersKnown?: boolean;
    salesKnown?: boolean;
    infoKnown?: boolean;
    vendorRankingKnown?: boolean;
  };
}

const PRIORITY_CACHE_KEY = "dashboard-priority-cache:v1";

export function readPriorityCache(routerId: number | null): PrioritySnapshot | null {
  if (!routerId) return null;
  try {
    const raw = localStorage.getItem(`${PRIORITY_CACHE_KEY}:${routerId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PrioritySnapshot;
    if (!parsed || typeof parsed.serverTs !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writePriorityCache(routerId: number | null, snapshot: PrioritySnapshot | null) {
  if (!routerId || !snapshot) return;
  try {
    localStorage.setItem(`${PRIORITY_CACHE_KEY}:${routerId}`, JSON.stringify(snapshot));
  } catch {
    // ignore
  }
}

export function mergePrioritySnapshots(
  http: PrioritySnapshot | undefined,
  sse: PrioritySnapshot | null,
  sseConnected: boolean,
): PrioritySnapshot | null {
  if (!sse) return http ?? null;
  if (!http) return sse;
  if (!sseConnected) return http;
  const sseTs = typeof sse.serverTs === "number" ? sse.serverTs : 0;
  const httpTs = typeof http.serverTs === "number" ? http.serverTs : 0;
  return httpTs >= sseTs ? http : sse;
}
