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
  dailyAmount?: number;
  monthlyAmount?: number;
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
/** Âge max du cache local (KPI dashboard) — cadence MikHmon 10 s. */
export const DASHBOARD_FRESH_MAX_AGE_MS = 10_000;
/** @deprecated Utiliser DASHBOARD_FRESH_MAX_AGE_MS */
export const PRIORITY_CACHE_MAX_AGE_MS = DASHBOARD_FRESH_MAX_AGE_MS;

export function readPriorityCache(routerId: number | null): PrioritySnapshot | null {
  if (!routerId) return null;
  try {
    const raw = localStorage.getItem(`${PRIORITY_CACHE_KEY}:${routerId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PrioritySnapshot;
    if (!parsed || typeof parsed.serverTs !== "number") return null;
    if (Date.now() - parsed.serverTs > DASHBOARD_FRESH_MAX_AGE_MS) return null;
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

/** Cache local utilisable pour affichage immédiat (au moins sessions ou utilisateurs connus). */
export function isPriorityCacheDisplayable(snapshot: PrioritySnapshot | null | undefined): boolean {
  if (!snapshot) return false;
  const a = snapshot.availability;
  if (!a) return true;
  return !!(a.sessionsKnown || a.usersKnown || a.salesKnown);
}

/** Snapshot MikroTik utilisable après connexion (local ou cache serveur partagé multi-appareils). */
export function isSnapshotMikrotikFreshAfterEpoch(
  snapshot: PrioritySnapshot | null | undefined,
  epochMs: number,
): boolean {
  if (!snapshot || epochMs <= 0) return false;
  const usersCa = snapshot.users?.cachedAt;
  if (typeof usersCa !== "number") return false;
  const ageMs = Date.now() - usersCa;
  if (
    ageMs <= DASHBOARD_FRESH_MAX_AGE_MS
    && snapshot.availability?.usersKnown !== false
  ) {
    return true;
  }
  return usersCa >= epochMs - 3_000;
}

/** Snapshot accepté seulement s'il est postérieur à l'époque de fraîcheur (switch routeur ou reprise app). */
export function snapshotValidForFreshEpoch(
  snapshot: PrioritySnapshot | null | undefined,
  epochStartedAt: number,
): snapshot is PrioritySnapshot {
  if (!snapshot || typeof snapshot.serverTs !== "number") return false;
  return snapshot.serverTs >= epochStartedAt - 800;
}

function newerSnapshot(a: PrioritySnapshot, b: PrioritySnapshot): PrioritySnapshot {
  const aTs = typeof a.serverTs === "number" ? a.serverTs : 0;
  const bTs = typeof b.serverTs === "number" ? b.serverTs : 0;
  return aTs >= bTs ? a : b;
}

/** Fusionne deux snapshots en conservant les métriques « connues » du plus complet. */
export function mergeKnownPriorityFields(base: PrioritySnapshot, incoming: PrioritySnapshot): PrioritySnapshot {
  const ba = base.availability ?? {};
  const ia = incoming.availability ?? {};
  const mergedAvail = {
    sessionsKnown: !!(ba.sessionsKnown || ia.sessionsKnown),
    usersKnown: !!(ba.usersKnown || ia.usersKnown),
    salesKnown: !!(ba.salesKnown || ia.salesKnown),
    infoKnown: !!(ba.infoKnown || ia.infoKnown),
    vendorRankingKnown: !!(ba.vendorRankingKnown || ia.vendorRankingKnown),
  };

  const newer = newerSnapshot(base, incoming);
  const pickNum = (knownIn: boolean | undefined, knownBa: boolean | undefined, vIn: number, vBa: number, fallback: number) =>
    knownIn ? vIn : knownBa ? vBa : fallback;

  return {
    ...newer,
    sessionsCount: pickNum(ia.sessionsKnown, ba.sessionsKnown, incoming.sessionsCount, base.sessionsCount, newer.sessionsCount),
    users: ia.usersKnown ? incoming.users : ba.usersKnown ? base.users : newer.users,
    sales: ia.salesKnown ? incoming.sales : ba.salesKnown ? base.sales : newer.sales,
    info: ia.infoKnown ? incoming.info : ba.infoKnown ? base.info : newer.info,
    vendorRanking: ia.vendorRankingKnown
      ? (incoming.vendorRanking ?? null)
      : ba.vendorRankingKnown
        ? (base.vendorRanking ?? null)
        : (newer.vendorRanking ?? null),
    availability: mergedAvail,
  };
}

export function mergePrioritySnapshots(
  http: PrioritySnapshot | undefined,
  sse: PrioritySnapshot | null,
  sseConnected: boolean,
  routerId?: number | null,
  opts?: { skipCacheMerge?: boolean },
): PrioritySnapshot | null {
  const cached = opts?.skipCacheMerge ? null : (routerId != null ? readPriorityCache(routerId) : null);

  let live: PrioritySnapshot | null = null;
  if (!sse) live = http ?? null;
  else if (!http) live = sse;
  else if (!sseConnected) live = http;
  else {
    const sseTs = typeof sse.serverTs === "number" ? sse.serverTs : 0;
    const httpTs = typeof http.serverTs === "number" ? http.serverTs : 0;
    live = httpTs >= sseTs ? http : sse;
  }

  if (!live && cached && isPriorityCacheDisplayable(cached)) return cached;
  if (!live) return null;
  if (!cached || !isPriorityCacheDisplayable(cached)) return live;
  return mergeKnownPriorityFields(cached, live);
}
