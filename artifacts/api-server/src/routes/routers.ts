import { Router } from "express";
import { eq, and, isNotNull, isNull, sql } from "drizzle-orm";
import { db, routersTable, vouchersTable, scriptSalesTable, routerProfilesSnapshotTable } from "@workspace/db";
import { testConnection, pingRouter, getRouterInfo, listProfiles, createProfile, updateProfile, deleteProfile, listAddressPools, listSessions, listHotspotUsers, addHotspotUser, disconnectSession, listLogs, fetchSalesFromScripts, fetchScriptSales, fetchInterfaceTraffic, listInterfaces, deleteHotspotUsersByComment, deleteHotspotUsersByNames, renameHotspotUser, resetHotspotUser, listIpBindings, addIpBinding, updateIpBinding, deleteIpBinding, type SalesReport, type RouterConnection } from "../lib/mikrotik.js";
import { runUsageSync } from "../lib/usage-sync.js";
import { syncScriptCache } from "../lib/script-cache.js";
import { syncProfileRenames } from "../lib/vendor-sync.js";
import { withRouterLock, isRouterLocked, lockRouter, unlockRouter } from "../lib/router-lock.js";

const router = Router();

interface ProfileListCache {
  profiles: Awaited<ReturnType<typeof listProfiles>>;
  expiresAt: number;
}
const profileListCache = new Map<number, ProfileListCache>();
const profileListInFlight = new Map<number, Promise<Awaited<ReturnType<typeof listProfiles>>>>();
const PROFILE_LIST_CACHE_TTL = 900_000; // 15 min

function getFreshProfileCache(routerId: number) {
  const cached = profileListCache.get(routerId);
  if (cached && Date.now() < cached.expiresAt) return cached.profiles;
  return null;
}

function setProfileCache(routerId: number, profiles: Awaited<ReturnType<typeof listProfiles>>) {
  profileListCache.set(routerId, { profiles, expiresAt: Date.now() + PROFILE_LIST_CACHE_TTL });
}

function invalidateProfileListCache(routerId: number) {
  profileListCache.delete(routerId);
}

async function fetchProfilesWithCache(routerId: number, conn: RouterConnection) {
  const inFlight = profileListInFlight.get(routerId);
  if (inFlight) return inFlight;

  const task = listProfiles(conn)
    .then((profiles) => {
      setProfileCache(routerId, profiles);
      return profiles;
    })
    .finally(() => {
      profileListInFlight.delete(routerId);
    });

  profileListInFlight.set(routerId, task);
  return task;
}

/* ── Generic in-memory TTL cache for MikroTik live-data endpoints ───────
 *
 * Key format: "<type>:<routerId>"  or  "<type>:<routerId>:<extra>"
 * TTLs are chosen so the UI feels instant while data stays acceptably fresh.
 *
 *   ping        30 s  — status probe, polled often by dashboard
 *   info        60 s  — uptime/resources, 1 min staleness acceptable
 *   pools        5 min — address pools rarely change
 *   sessions    15 s  — active hotspot sessions
 *   interfaces   5 min — interface list rarely changes
 *   traffic      8 s  — live bandwidth; cache prevents burst calls
 *   logs        10 s  — system log tail
 */
const _mik = new Map<string, { data: unknown; exp: number }>();
function mGet(k: string) { const e = _mik.get(k); return (e && Date.now() < e.exp) ? e.data : null; }
/** Returns cached data even if expired (stale-while-revalidate pattern). */
function mGetStale(k: string) { return _mik.get(k)?.data ?? null; }
function mSet(k: string, ttl: number, d: unknown) { _mik.set(k, { data: d, exp: Date.now() + ttl }); }

const MIK_TTL = {
  ping:       30_000,
  info:        8_000,
  pools:     300_000,
  sessions:   15_000,
  interfaces:300_000,
  traffic:     8_000,
  logs:       10_000,
} as const;

router.get("/routers", async (_req, res): Promise<void> => {
  const routers = await db
    .select({
      id: routersTable.id,
      name: routersTable.name,
      hotspotName: routersTable.hotspotName,
      contact: routersTable.contact,
      host: routersTable.host,
      port: routersTable.port,
      username: routersTable.username,
      isActive: routersTable.isActive,
      createdAt: routersTable.createdAt,
      updatedAt: routersTable.updatedAt,
    })
    .from(routersTable)
    .orderBy(routersTable.name);
  res.json(routers);
});

router.post("/routers", async (req, res): Promise<void> => {
  const { name, hotspotName, contact, host, port, username, password, isActive } = req.body as {
    name?: string;
    hotspotName?: string;
    contact?: string;
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    isActive?: boolean;
  };

  if (!name || !host || !username || !password) {
    res.status(400).json({ error: "name, host, username et password sont requis" });
    return;
  }

  const [created] = await db
    .insert(routersTable)
    .values({
      name,
      hotspotName: hotspotName ?? null,
      contact: contact ?? null,
      host,
      port: port ?? 8728,
      username,
      password,
      isActive: isActive ?? true,
    })
    .returning({
      id: routersTable.id,
      name: routersTable.name,
      hotspotName: routersTable.hotspotName,
      contact: routersTable.contact,
      host: routersTable.host,
      port: routersTable.port,
      username: routersTable.username,
      isActive: routersTable.isActive,
      createdAt: routersTable.createdAt,
      updatedAt: routersTable.updatedAt,
    });

  res.status(201).json(created);
});

router.get("/routers/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [r] = await db
    .select({
      id: routersTable.id,
      name: routersTable.name,
      hotspotName: routersTable.hotspotName,
      contact: routersTable.contact,
      host: routersTable.host,
      port: routersTable.port,
      username: routersTable.username,
      isActive: routersTable.isActive,
      createdAt: routersTable.createdAt,
      updatedAt: routersTable.updatedAt,
    })
    .from(routersTable)
    .where(eq(routersTable.id, id));

  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }
  res.json(r);
});

router.put("/routers/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const { name, hotspotName, contact, host, port, username, password, isActive } = req.body as {
    name?: string;
    hotspotName?: string;
    contact?: string;
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    isActive?: boolean;
  };

  const updates: Partial<typeof routersTable.$inferInsert> = {};
  if (name !== undefined) updates.name = name;
  if (hotspotName !== undefined) updates.hotspotName = hotspotName || null;
  if (contact !== undefined) updates.contact = contact || null;
  if (host !== undefined) updates.host = host;
  if (port !== undefined) updates.port = port;
  if (username !== undefined) updates.username = username;
  if (password !== undefined) updates.password = password;
  if (isActive !== undefined) updates.isActive = isActive;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Aucun champ à mettre à jour" });
    return;
  }

  const [updated] = await db
    .update(routersTable)
    .set(updates)
    .where(eq(routersTable.id, id))
    .returning({
      id: routersTable.id,
      name: routersTable.name,
      hotspotName: routersTable.hotspotName,
      contact: routersTable.contact,
      host: routersTable.host,
      port: routersTable.port,
      username: routersTable.username,
      isActive: routersTable.isActive,
      createdAt: routersTable.createdAt,
      updatedAt: routersTable.updatedAt,
    });

  if (!updated) { res.status(404).json({ error: "Routeur introuvable" }); return; }
  res.json(updated);
});

router.delete("/routers/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [deleted] = await db.delete(routersTable).where(eq(routersTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Routeur introuvable" }); return; }
  res.sendStatus(204);
});

router.post("/routers/:id/test", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  const result = await testConnection({ host: r.host, port: r.port, username: r.username, password: r.password });
  res.json(result);
});

router.get("/routers/:id/ping", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const ck = `ping:${id}`;
  const force = req.query.force === "1";
  if (!force) {
    const hit = mGet(ck);
    if (hit) { res.json(hit); return; }
  }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  const online = await pingRouter({ host: r.host, port: r.port, username: r.username, password: r.password });
  const payload = { success: online };
  mSet(ck, MIK_TTL.ping, payload);
  res.json(payload);
});

/* ── Generation session lock ──────────────────────────────────────────────
 * Holds the router lock for the entire generation session (all batches).
 * Background sync (vendor/usage) skips locked routers automatically.
 * Auto-releases after 30 min as a safety net against client disconnects. */
const _genLockTimeouts = new Map<number, ReturnType<typeof setTimeout>>();

router.post("/routers/:id/generation-lock", (req, res): void => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  lockRouter(id);
  const existing = _genLockTimeouts.get(id);
  if (existing) clearTimeout(existing);
  _genLockTimeouts.set(id, setTimeout(() => {
    unlockRouter(id);
    _genLockTimeouts.delete(id);
  }, 30 * 60_000));
  res.json({ ok: true });
});

router.delete("/routers/:id/generation-lock", (req, res): void => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  unlockRouter(id);
  const t = _genLockTimeouts.get(id);
  if (t) { clearTimeout(t); _genLockTimeouts.delete(id); }
  res.json({ ok: true });
});

router.get("/routers/:id/info", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const ck = `info:${id}`;

  // Fresh hit — return immediately
  const fresh = mGet(ck);
  if (fresh) { res.json(fresh); return; }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  // Stale hit — return immediately, refresh in background (stale-while-revalidate)
  const stale = mGetStale(ck);
  if (stale) {
    res.json(stale);
    setImmediate(async () => {
      try {
        const info = await getRouterInfo({ host: r.host, port: r.port, username: r.username, password: r.password });
        mSet(ck, MIK_TTL.info, info);
      } catch { /* ignore */ }
    });
    return;
  }

  // No cache at all — blocking call (first request only)
  try {
    const info = await getRouterInfo({ host: r.host, port: r.port, username: r.username, password: r.password });
    mSet(ck, MIK_TTL.info, info);
    res.json(info);
  } catch (err) {
    res.status(503).json({ error: err instanceof Error ? err.message : "Erreur" });
  }
});

router.get("/routers/:id/profiles", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  const conn = { host: r.host, port: r.port, username: r.username, password: r.password };
  const freshCached = getFreshProfileCache(id);
  const forceRefresh = String(req.query.refresh ?? "") === "1";
  const staleCached = profileListCache.get(id)?.profiles ?? null;

  /** Persist a successful fetch to DB so it survives server restarts. */
  async function saveSnapshot(profiles: typeof freshCached) {
    if (!profiles) return;
    try {
      await db.insert(routerProfilesSnapshotTable)
        .values({ routerId: id, profilesJson: JSON.stringify(profiles) })
        .onConflictDoUpdate({
          target: routerProfilesSnapshotTable.routerId,
          set: { profilesJson: JSON.stringify(profiles), updatedAt: new Date() },
        });
    } catch { /* non-blocking */ }
  }

  /** Load the last persisted snapshot from DB. */
  async function loadSnapshot() {
    try {
      const [row] = await db.select().from(routerProfilesSnapshotTable)
        .where(eq(routerProfilesSnapshotTable.routerId, id));
      if (!row) return null;
      return JSON.parse(row.profilesJson) as typeof freshCached;
    } catch { return null; }
  }

  // Always return cached data immediately when available (even if ?refresh=1).
  // Refresh in background so the caller never has to wait for MikroTik.
  if (freshCached) {
    if (forceRefresh) void fetchProfilesWithCache(id, conn).then(saveSnapshot).catch(() => undefined);
    res.json(freshCached);
    return;
  }
  if (staleCached) {
    // Stale-while-revalidate: return instantly, refresh in background.
    void fetchProfilesWithCache(id, conn).then(saveSnapshot).catch(() => undefined);
    res.json(staleCached);
    return;
  }

  // Cache is empty (first request after server start).
  // Try MikroTik; on failure fall back to DB snapshot so the UI is never blank.
  try {
    const fetched = await fetchProfilesWithCache(id, conn);
    void saveSnapshot(fetched);
    res.json(fetched);
  } catch (err) {
    const snapshot = await loadSnapshot();
    if (snapshot) { res.json(snapshot); return; }
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de contacter le routeur" });
  }
});

router.post("/routers/:id/profiles", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  const { name, validity, price, sellingPrice, sharedUsers, addrPool, rateLimit, expiredMode, lockMac, parentQueue } = req.body as {
    name?: string; validity?: string; price?: string; sellingPrice?: string;
    sharedUsers?: string; addrPool?: string; rateLimit?: string;
    expiredMode?: string; lockMac?: boolean; parentQueue?: string;
  };
  if (!name || !price || !validity) {
    res.status(400).json({ error: "Champs obligatoires manquants : name, price, validity" }); return;
  }

  try {
    await createProfile(
      { host: r.host, port: r.port, username: r.username, password: r.password },
      {
        name: name.trim(),
        validity: validity.trim(),
        price: price.trim(),
        sellingPrice: (sellingPrice ?? "").trim(),
        sharedUsers: (sharedUsers ?? "1").trim(),
        addrPool: (addrPool ?? "").trim(),
        rateLimit: (rateLimit ?? "").trim(),
        expiredMode: (expiredMode ?? "None").trim(),
        lockMac: lockMac === true,
        parentQueue: (parentQueue ?? "").trim(),
      },
    );
    invalidateProfileListCache(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de créer le profil" });
  }
});

router.put("/routers/:id/profiles/:profileName", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const originalName = decodeURIComponent(req.params.profileName as string);
  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  const { name, validity, price, sellingPrice, sharedUsers, addrPool, rateLimit, expiredMode, lockMac, parentQueue } = req.body as {
    name?: string; validity?: string; price?: string; sellingPrice?: string;
    sharedUsers?: string; addrPool?: string; rateLimit?: string;
    expiredMode?: string; lockMac?: boolean; parentQueue?: string;
  };
  if (!name || !price || !validity) {
    res.status(400).json({ error: "Champs obligatoires manquants : name, price, validity" }); return;
  }

  try {
    await updateProfile(
      { host: r.host, port: r.port, username: r.username, password: r.password },
      originalName,
      {
        name: name.trim(),
        validity: validity.trim(),
        price: price.trim(),
        sellingPrice: (sellingPrice ?? "").trim(),
        sharedUsers: (sharedUsers ?? "1").trim(),
        addrPool: (addrPool ?? "").trim(),
        rateLimit: (rateLimit ?? "").trim(),
        expiredMode: (expiredMode ?? "None").trim(),
        lockMac: lockMac === true,
        parentQueue: (parentQueue ?? "").trim(),
      },
    );
    invalidateProfileListCache(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de modifier le profil" });
  }
});

/** GET /routers/:id/profiles/db — distinct profile names stored in the local DB for this router */
router.get("/routers/:id/profiles/db", async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const rows = await db
    .select({
      profileName: vouchersTable.profileName,
      total:       sql<number>`count(*)::int`,
      available:   sql<number>`count(*) filter (where ${vouchersTable.usedAt} is null)::int`,
      sold:        sql<number>`count(*) filter (where ${vouchersTable.usedAt} is not null)::int`,
    })
    .from(vouchersTable)
    .where(eq(vouchersTable.routerId, id))
    .groupBy(vouchersTable.profileName)
    .orderBy(vouchersTable.profileName);

  res.json(rows);
});

/** POST /routers/:id/profiles/merge — rename all vouchers from one profile name to another */
router.post("/routers/:id/profiles/merge", async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const { from, to } = req.body as { from?: string; to?: string };
  if (!from || !to) { res.status(400).json({ error: "Champs 'from' et 'to' requis" }); return; }
  if (from === to)   { res.status(400).json({ error: "'from' et 'to' sont identiques" }); return; }

  const result = await db
    .update(vouchersTable)
    .set({ profileName: to })
    .where(and(eq(vouchersTable.routerId, id), eq(vouchersTable.profileName, from)))
    .returning({ id: vouchersTable.id });

  res.json({ ok: true, updated: result.length });
});

/**
 * POST /routers/:id/profiles/sync-names
 * Manually trigger the profile rename detection for a specific router.
 * Fetches current profiles from MikroTik, compares with the persisted
 * mikrotikId→name cache, and bulk-updates ALL vouchers (sold + unsold)
 * when a rename is detected.
 */
router.post("/routers/:id/profiles/sync-names", async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  try {
    await syncProfileRenames(id, { host: r.host, port: r.port, username: r.username, password: r.password });
    invalidateProfileListCache(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.delete("/routers/:id/profiles/:profileName", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const profileName = decodeURIComponent(req.params.profileName as string);
  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  try {
    await deleteProfile(
      { host: r.host, port: r.port, username: r.username, password: r.password },
      profileName,
    );
    invalidateProfileListCache(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de supprimer le profil" });
  }
});

router.get("/routers/:id/pools", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const ck = `pools:${id}`;
  const hit = mGet(ck);
  if (hit) { res.json(hit); return; }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  try {
    const pools = await listAddressPools({ host: r.host, port: r.port, username: r.username, password: r.password });
    mSet(ck, MIK_TTL.pools, pools);
    res.json(pools);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de contacter le routeur" });
  }
});

router.get("/routers/:id/sessions", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const ck = `sessions:${id}`;
  const hit = mGet(ck);
  if (hit) { res.json(hit); return; }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  try {
    const sessions = await listSessions({ host: r.host, port: r.port, username: r.username, password: r.password });
    mSet(ck, MIK_TTL.sessions, sessions);
    res.json(sessions);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de contacter le routeur" });
  }
});

// GET /routers/:id/sessions/count — Mikhmon-style: returns the last known
// count instantly (stale-while-revalidate). Never blocks on MikroTik when a
// previous value (even expired) is available; refreshes in background.
const _sessionsRefreshing = new Set<number>();
router.get("/routers/:id/sessions/count", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const ck = `sessions:${id}`;
  const fresh = mGet(ck) as unknown[] | null;
  if (fresh) { res.json({ count: fresh.length, cached: true }); return; }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  // Stale hit — return immediately, refresh in background (Mikhmon-style)
  const stale = mGetStale(ck) as unknown[] | null;
  if (stale) {
    res.json({ count: stale.length, cached: true, stale: true });
    if (!_sessionsRefreshing.has(id)) {
      _sessionsRefreshing.add(id);
      setImmediate(async () => {
        try {
          const sessions = await listSessions({ host: r.host, port: r.port, username: r.username, password: r.password });
          mSet(ck, MIK_TTL.sessions, sessions);
        } catch { /* keep stale */ }
        finally { _sessionsRefreshing.delete(id); }
      });
    }
    return;
  }

  // No cache at all — blocking call (first ever request only)
  try {
    const sessions = await listSessions({ host: r.host, port: r.port, username: r.username, password: r.password });
    mSet(ck, MIK_TTL.sessions, sessions);
    res.json({ count: sessions.length, cached: false });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de contacter le routeur" });
  }
});

interface UserCache { users: Awaited<ReturnType<typeof listHotspotUsers>>; expiresAt: number; }
const userCache = new Map<number, UserCache>();
const USER_CACHE_TTL = 300_000; // 5 min — large enough so frontend never expires first

async function getCachedUsers(
  id: number,
  conn: Parameters<typeof listHotspotUsers>[0],
  opts: { force?: boolean } = {},
) {
  const cached = userCache.get(id);
  if (!opts.force && cached && Date.now() < cached.expiresAt) return cached.users;
  const users = await listHotspotUsers(conn, 60_000);
  userCache.set(id, { users, expiresAt: Date.now() + USER_CACHE_TTL });
  return users;
}

/** Call this after any action that modifies hotspot users (disable/enable/reset/delete/rename). */
export function invalidateUserCache(routerId: number) {
  userCache.delete(routerId);
  _usersCountCache.delete(routerId);
}

/**
 * Surgically patch a single user in the cache instead of invalidating it.
 * Used by reset/rename to avoid a full re-fetch of thousands of users.
 * Returns true if a row was patched.
 */
function patchCachedUser(
  routerId: number,
  username: string,
  patch: Partial<Awaited<ReturnType<typeof listHotspotUsers>>[number]>,
): boolean {
  const cached = userCache.get(routerId);
  if (!cached) return false;
  const target = username.toLowerCase();
  for (const u of cached.users) {
    if (u.username.toLowerCase() === target) {
      Object.assign(u, patch);
      // The /count payload depends on usedSet from DB, not on user fields we
      // just patched, so leave it alone — but we do bump cachedAt so it
      // doesn't look "stale" to the next reader.
      const cnt = _usersCountCache.get(routerId);
      if (cnt) cnt.cachedAt = Date.now();
      return true;
    }
  }
  return false;
}

/**
 * GET /routers/:id/users/count
 * Lightweight: returns just `{ total, available, used, disabled, cachedAt }`.
 * Mikhmon-style stale-while-revalidate: as long as we have a previous user
 * snapshot (even past TTL), we serve it instantly and refresh in background.
 */
const _usersRefreshing = new Set<number>();
type UsersCountPayload = {
  total: number;
  available: number;
  used: number;
  disabled: number;
  cachedAt: number;
  cached: boolean;
  stale?: boolean;
};
const _usersCountCache = new Map<number, UsersCountPayload>();

async function computeUsersCount(
  routerId: number,
  conn: Parameters<typeof listHotspotUsers>[0],
  users: Awaited<ReturnType<typeof listHotspotUsers>>,
): Promise<UsersCountPayload> {
  const usedRows = await db
    .select({ username: vouchersTable.username })
    .from(vouchersTable)
    .where(and(eq(vouchersTable.routerId, routerId), isNotNull(vouchersTable.usedAt)));
  const usedSet = new Set(usedRows.map((v) => v.username.toLowerCase()));
  let available = 0;
  let disabled  = 0;
  for (const u of users) {
    if (u.disabled) { disabled++; continue; }
    const prof = (u.profile ?? "").toLowerCase();
    if (prof === "trial" || prof === "default-trial") continue;
    if (u.macAddress) continue;
    if (usedSet.has(u.username.toLowerCase())) continue;
    available++;
  }
  void conn; // signature kept for future use
  return {
    total: users.length,
    available,
    used: usedSet.size,
    disabled,
    cachedAt: Date.now(),
    cached: false,
  };
}

router.get("/routers/:id/users/count", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }
  const conn = { host: r.host, port: r.port, username: r.username, password: r.password };

  const userHit = userCache.get(id);
  const userFresh = !!userHit && Date.now() < userHit.expiresAt;
  const cachedPayload = _usersCountCache.get(id);

  // Counts go stale much faster than the user-list snapshot (the DB-derived
  // `used`/`available` numbers depend on usage sync, which runs every ~30s).
  // Keep the count payload "fresh" only for ~20s so we re-query DB regularly,
  // while still serving older payloads instantly via the stale path below.
  const COUNT_FRESH_MS = 20_000;
  if (userFresh && cachedPayload && (Date.now() - cachedPayload.cachedAt) < COUNT_FRESH_MS) {
    res.json({ ...cachedPayload, cached: true });
    return;
  }

  // Stale path — we have *some* previous payload: serve it + refresh in bg
  if (cachedPayload) {
    res.json({ ...cachedPayload, cached: true, stale: true });
    if (!_usersRefreshing.has(id)) {
      _usersRefreshing.add(id);
      setImmediate(async () => {
        try {
          const users = await getCachedUsers(id, conn, { force: !userFresh });
          const payload = await computeUsersCount(id, conn, users);
          _usersCountCache.set(id, payload);
        } catch { /* keep stale */ }
        finally { _usersRefreshing.delete(id); }
      });
    }
    return;
  }

  // Cold start — must block to compute the very first payload
  try {
    const users = await getCachedUsers(id, conn);
    const payload = await computeUsersCount(id, conn, users);
    _usersCountCache.set(id, payload);
    res.json(payload);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de contacter le routeur" });
  }
});

router.get("/routers/:id/users", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const { search, profile, comment: commentFilter, limit: limitStr, offset: offsetStr, refresh } = req.query as {
    search?: string; profile?: string; comment?: string; limit?: string; offset?: string; refresh?: string;
  };

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  try {
    const conn = { host: r.host, port: r.port, username: r.username, password: r.password };
    let users = await getCachedUsers(id, conn, { force: refresh === "1" || refresh === "true" });

    if (search) {
      const q = search.toLowerCase();
      users = users.filter(
        (u) =>
          u.username.toLowerCase().includes(q) ||
          u.password.toLowerCase().includes(q) ||
          (u.comment ?? "").toLowerCase().includes(q) ||
          u.profile.toLowerCase().includes(q),
      );
    }
    if (profile) {
      users = users.filter((u) => u.profile === profile);
    }
    if (commentFilter) {
      users = users.filter((u) => (u.comment ?? "") === commentFilter);
    }

    const total = users.length;
    const limit = limitStr ? parseInt(limitStr, 10) : 100;
    const offset = offsetStr ? parseInt(offsetStr, 10) : 0;
    const paged = users.slice(offset, offset + limit);

    res.json({ users: paged, total });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de contacter le routeur" });
  }
});

// POST /routers/:id/hotspot-users — add a single MikroTik hotspot user
router.post("/routers/:id/hotspot-users", async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const { name, password, profile, comment, server, limitUptime, limitBytesTotal, macAddress } = req.body as {
    name?: string; password?: string; profile?: string; comment?: string;
    server?: string; limitUptime?: string; limitBytesTotal?: string; macAddress?: string;
  };

  if (!name?.trim())     { res.status(400).json({ error: "Le nom d'utilisateur est requis" }); return; }
  if (!password?.trim()) { res.status(400).json({ error: "Le mot de passe est requis" }); return; }
  if (!profile?.trim())  { res.status(400).json({ error: "Le profil est requis" }); return; }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  const conn: RouterConnection = { host: r.host, port: r.port, username: r.username, password: r.password };
  try {
    await withRouterLock(id, () => addHotspotUser(conn, {
      name: name.trim(),
      password: password.trim(),
      profile: profile.trim(),
      comment: comment?.trim() || undefined,
      server: server?.trim() || undefined,
      limitUptime: limitUptime?.trim() || undefined,
      limitBytesTotal: limitBytesTotal?.trim() || undefined,
      macAddress: macAddress?.trim() || undefined,
    }));
    // Invalidate user/list/count caches so subsequent reads see the new user immediately
    invalidateUserCache(id);
    res.status(201).json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur MikroTik";
    res.status(502).json({ error: msg });
  }
});

// GET /routers/:id/lots — lightweight lot aggregation from server cache
router.get("/routers/:id/lots", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  try {
    const conn = { host: r.host, port: r.port, username: r.username, password: r.password };
    const [users, soldRows] = await Promise.all([
      getCachedUsers(id, conn),
      db
        .select({ username: vouchersTable.username })
        .from(vouchersTable)
        .where(and(eq(vouchersTable.routerId, id), isNotNull(vouchersTable.usedAt))),
    ]);
    const soldSet = new Set(soldRows.map((r) => r.username.toLowerCase()));

    // Patterns that identify system / non-batch comments — exclude from lots
    const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[\s_T]\d{2}:\d{2}/;  // "2026-04-11 21:27:42"
    const SYSTEM_KEYWORDS = ["counters and limits", "trial", "default-trial", "hotspot"];
    function isValidBatchComment(comment: string): boolean {
      if (!comment) return false;
      if (TIMESTAMP_RE.test(comment)) return false;
      const lc = comment.toLowerCase();
      if (SYSTEM_KEYWORDS.some((kw) => lc.includes(kw))) return false;
      return true;
    }

    const map = new Map<string, { count: number; profiles: Set<string>; preview: typeof users }>();
    for (const u of users) {
      // Skip used vouchers: MAC address = currently in use on MikroTik, or tracked as used in DB
      if (u.macAddress || soldSet.has(u.username.toLowerCase())) continue;
      // Skip trial profile — internal/demo accounts, not real batches
      if (u.profile?.toLowerCase() === "trial" || u.profile?.toLowerCase() === "default-trial") continue;
      const key = u.comment ?? "";
      if (!isValidBatchComment(key)) continue;
      const entry = map.get(key) ?? { count: 0, profiles: new Set(), preview: [] };
      entry.count++;
      entry.profiles.add(u.profile);
      if (entry.preview.length < 4) entry.preview.push(u);
      map.set(key, entry);
    }

    // Extract date key for sorting: MM.DD.YY → YY.MM.DD
    // Works even when a vendor suffix follows (e.g. "vc-123-04.11.26_m")
    const DATE_RE = /(\d{2})\.(\d{2})\.(\d{2})/;
    const dateSortKey = (n: string): string => {
      const m = n.match(DATE_RE);
      if (!m) return "\x00"; // unknown → oldest
      const [, mm, dd, yy] = m;
      return `${yy}.${mm}.${dd}`; // YY.MM.DD → lexicographic = chronological
    };

    const lots = Array.from(map.entries())
      .map(([name, data]) => ({
        name,
        count: data.count,
        profile: data.profiles.size === 1 ? [...data.profiles][0] : null,
        preview: data.preview,
      }))
      .sort((a, b) => {
        const cmp = dateSortKey(b.name).localeCompare(dateSortKey(a.name));
        return cmp !== 0 ? cmp : b.name.localeCompare(a.name); // tie-break: alpha desc
      });

    res.json({ lots, total: users.length });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de contacter le routeur" });
  }
});

// DELETE /routers/:id/users — bulk delete MikroTik hotspot users
// Query param ?comment=xxx  → delete all users with that comment
// Body { usernames: string[] }  → delete specific users by username
router.delete("/routers/:id/users", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  const conn = { host: r.host, port: r.port, username: r.username, password: r.password };
  const { comment: commentFilter } = req.query as { comment?: string };
  const { usernames } = (req.body ?? {}) as { usernames?: string[] };

  if (!commentFilter && !(Array.isArray(usernames) && usernames.length > 0)) {
    res.status(400).json({ error: "Fournir comment ou usernames" });
    return;
  }
  try {
    const deleted = await withRouterLock(id, async () => {
      if (commentFilter) return deleteHotspotUsersByComment(conn, commentFilter);
      return deleteHotspotUsersByNames(conn, usernames!);
    });
    // Invalidate cache so subsequent requests get fresh data
    userCache.delete(id);
    res.json({ deleted });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de contacter le routeur" });
  }
});

// PATCH /routers/:id/users/:username — rename a hotspot user
router.patch("/routers/:id/users/:username", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const oldUsername = decodeURIComponent(req.params.username as string);
  const { newUsername } = (req.body ?? {}) as { newUsername?: string };
  if (!newUsername || typeof newUsername !== "string" || !newUsername.trim()) {
    res.status(400).json({ error: "newUsername requis" });
    return;
  }
  const trimmed = newUsername.trim();

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  const conn = { host: r.host, port: r.port, username: r.username, password: r.password };
  try {
    const found = await renameHotspotUser(conn, oldUsername, trimmed);
    if (!found) { res.status(404).json({ error: "Utilisateur introuvable sur le routeur" }); return; }
    // Invalidate user cache so next list reflects new name
    userCache.delete(id);
    // Also update any voucher DB records that tracked this username
    await db
      .update(vouchersTable)
      .set({ username: trimmed })
      .where(and(eq(vouchersTable.routerId, id), eq(vouchersTable.username, oldUsername)));
    res.json({ ok: true, oldUsername, newUsername: trimmed });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de contacter le routeur" });
  }
});

router.post("/routers/:id/users/:username/reset", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const username = decodeURIComponent(req.params.username as string);

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  const conn = { host: r.host, port: r.port, username: r.username, password: r.password };
  try {
    const result = await withRouterLock(id, async () => {
      const r2 = await resetHotspotUser(conn, username);
      if (!r2.found) return r2;

      // Clear usedAt + sale fields in DB so the voucher is marked unsold again.
      // Username column is case-insensitive matched (lower) to align with the
      // sync logic which compares with toLowerCase().
      await db
        .update(vouchersTable)
        .set({ usedAt: null, salePrice: null, macAddress: null, saleIp: null })
        .where(and(
          eq(vouchersTable.routerId, id),
          sql`lower(${vouchersTable.username}) = lower(${username})`,
        ));

      // Purge local script-sales cache rows (case-insensitive) so the
      // background usage-sync does not immediately re-mark the voucher as used.
      await db
        .delete(scriptSalesTable)
        .where(and(
          eq(scriptSalesTable.routerId, id),
          sql`lower(${scriptSalesTable.username}) = lower(${username})`,
        ));

      return r2;
    });

    if (!result.found) {
      console.warn(`[reset] user not found on router id=${id} username=${JSON.stringify(username)} (len=${username.length})`);
      res.status(404).json({ error: `Utilisateur "${username}" introuvable sur le routeur` });
      return;
    }

    // Surgically patch the cached snapshot so the next list call returns the
    // post-reset state instantly (no MikroTik round-trip for thousands of
    // users). The fields below mirror what `resetHotspotUser` writes back:
    // a pristine voucher with no comment, no quota override, no MAC binding.
    const patched = patchCachedUser(id, username, {
      comment: null,
      limitUptime: null,
      limitBytesTotal: null,
      macAddress: null,
    });
    if (!patched) userCache.delete(id);
    res.json({
      ok: true,
      username,
      sessionKicked: result.sessionKicked,
      salesScriptsRemoved: result.salesScriptsRemoved,
      salesScriptsFailed: result.salesScriptsFailed,
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de contacter le routeur" });
  }
});

// ─── Hotspot IP-bindings (MAC bypass) ────────────────────────────────────────
//
// Direct passthrough to MikroTik /ip/hotspot/ip-binding (no caching — list
// is small and changes are admin-driven, not high-frequency).

router.get("/routers/:id/ip-bindings", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }
  try {
    const conn: RouterConnection = { host: r.host, port: r.port, username: r.username, password: r.password };
    const bindings = await listIpBindings(conn);
    res.json({ bindings });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de contacter le routeur" });
  }
});

// Shared payload validation for POST/PATCH ip-binding requests.
// Returns either a sanitized opts object or an { error } message.
const VALID_BINDING_TYPES = new Set(["bypassed", "blocked", "regular"]);
const MAC_RE = /^[0-9A-Fa-f]{2}([:-][0-9A-Fa-f]{2}){5}$/;
function parseBindingPayload(body: unknown, opts: { partial: boolean }):
  | { error: string }
  | {
      macAddress?: string; address?: string; toAddress?: string;
      type?: "bypassed" | "blocked" | "regular"; server?: string;
      comment?: string; disabled?: boolean;
    }
{
  if (!body || typeof body !== "object") return { error: "Corps de requête invalide" };
  const b = body as Record<string, unknown>;
  const out: {
    macAddress?: string; address?: string; toAddress?: string;
    type?: "bypassed" | "blocked" | "regular"; server?: string;
    comment?: string; disabled?: boolean;
  } = {};
  // String fields — accept undefined; validate type when present.
  for (const k of ["macAddress", "address", "toAddress", "server", "comment"] as const) {
    if (b[k] !== undefined) {
      if (typeof b[k] !== "string") return { error: `Champ ${k} invalide` };
      out[k] = b[k] as string;
    }
  }
  if (b.type !== undefined) {
    if (typeof b.type !== "string" || !VALID_BINDING_TYPES.has(b.type)) {
      return { error: "Type invalide (bypassed|blocked|regular)" };
    }
    out.type = b.type as "bypassed" | "blocked" | "regular";
  }
  if (b.disabled !== undefined) {
    if (typeof b.disabled !== "boolean") return { error: "Champ disabled doit être booléen" };
    out.disabled = b.disabled;
  }
  // Create requires at least MAC or IP; partial updates may touch a single field.
  if (!opts.partial) {
    if (!out.macAddress?.trim() && !out.address?.trim()) {
      return { error: "Adresse MAC ou IP requise" };
    }
  }
  if (out.macAddress !== undefined && out.macAddress !== "" && !MAC_RE.test(out.macAddress.trim())) {
    return { error: "Adresse MAC invalide (format attendu : AA:BB:CC:DD:EE:FF)" };
  }
  return out;
}

router.post("/routers/:id/ip-bindings", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const parsed = parseBindingPayload(req.body, { partial: false });
  if ("error" in parsed) { res.status(400).json(parsed); return; }
  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }
  try {
    const conn: RouterConnection = { host: r.host, port: r.port, username: r.username, password: r.password };
    await withRouterLock(id, () => addIpBinding(conn, parsed));
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Erreur MikroTik" });
  }
});

router.patch("/routers/:id/ip-bindings/:bindingId", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  // Express already URL-decodes route params, so use the raw value.
  const bindingId = req.params.bindingId as string;
  if (isNaN(id) || !bindingId) { res.status(400).json({ error: "Paramètre invalide" }); return; }
  const parsed = parseBindingPayload(req.body, { partial: true });
  if ("error" in parsed) { res.status(400).json(parsed); return; }
  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }
  try {
    const conn: RouterConnection = { host: r.host, port: r.port, username: r.username, password: r.password };
    await withRouterLock(id, () => updateIpBinding(conn, bindingId, parsed));
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Erreur MikroTik" });
  }
});

router.delete("/routers/:id/ip-bindings/:bindingId", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  // Express already URL-decodes route params, so use the raw value.
  const bindingId = req.params.bindingId as string;
  if (isNaN(id) || !bindingId) { res.status(400).json({ error: "Paramètre invalide" }); return; }
  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }
  try {
    const conn: RouterConnection = { host: r.host, port: r.port, username: r.username, password: r.password };
    await withRouterLock(id, () => deleteIpBinding(conn, bindingId));
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Erreur MikroTik" });
  }
});

// ─── Sales cache ─────────────────────────────────────────────────────────────
interface SalesCacheEntry { data: SalesReport; updatedAt: number; }
const salesCache = new Map<number, SalesCacheEntry>();
const salesRefreshing = new Set<number>();
const SALES_TTL = 5 * 60 * 1000; // 5 minutes

async function triggerSalesRefresh(id: number, host: string, port: number, username: string, password: string) {
  if (salesRefreshing.has(id)) return;
  salesRefreshing.add(id);
  try {
    const conn = { host, port, username, password };
    // Use 90s timeout — background, not constrained by Replit proxy
    const data = await fetchSalesFromScripts(conn, 90_000);
    salesCache.set(id, { data, updatedAt: Date.now() });
  } catch { /* keep stale cache on error */ } finally {
    salesRefreshing.delete(id);
  }
}

// ─── Usage sync (real-time sold voucher detection) ───────────────────────────
interface UsageSyncEntry { updatedAt: number; updated: number; total: number; }
const usageSyncCache  = new Map<number, UsageSyncEntry>();
const usageSyncActive = new Set<number>(); // routers currently syncing
const usageSyncTimer  = new Map<number, ReturnType<typeof setTimeout>>();
const USAGE_SYNC_INTERVAL = 30_000; // 30 seconds

/** Core sync logic — shared by background and manual trigger */

/** Background auto-sync — self-reschedules every USAGE_SYNC_INTERVAL */
async function scheduleUsageSync(routerId: number, conn: RouterConnection) {
  if (usageSyncActive.has(routerId)) return;
  // If a user-initiated operation has locked this router, skip this cycle
  // and come back next interval rather than fighting for a connection.
  if (isRouterLocked(routerId)) {
    const timer = setTimeout(() => scheduleUsageSync(routerId, conn), USAGE_SYNC_INTERVAL);
    usageSyncTimer.set(routerId, timer);
    return;
  }
  usageSyncActive.add(routerId);
  try {
    // Refresh the script cache first (incremental — only current + last month),
    // then run usage sync which reads from the cache (no extra MikroTik call).
    await syncScriptCache(routerId, conn);
    const result = await runUsageSync(routerId, conn);
    usageSyncCache.set(routerId, { updatedAt: Date.now(), ...result });
  } catch { /* keep stale cache on error */ } finally {
    usageSyncActive.delete(routerId);
    // Reschedule next run
    const timer = setTimeout(() => scheduleUsageSync(routerId, conn), USAGE_SYNC_INTERVAL);
    usageSyncTimer.set(routerId, timer);
  }
}

/** Start auto-sync for a router if not already scheduled */
function ensureUsageSyncScheduled(routerId: number, conn: RouterConnection) {
  if (!usageSyncTimer.has(routerId) && !usageSyncActive.has(routerId)) {
    scheduleUsageSync(routerId, conn);
  }
}

router.get("/routers/:id/sales", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  const cached = salesCache.get(id);
  const now = Date.now();

  // Trigger background refresh if cache is absent, stale (> TTL), or aging (> 2min)
  const needsRefresh = !cached || (now - cached.updatedAt) > SALES_TTL;
  const agingRefresh = cached && (now - cached.updatedAt) > 2 * 60 * 1000;
  if (needsRefresh || agingRefresh) {
    triggerSalesRefresh(id, r.host, r.port, r.username, r.password);
  }
  // Also ensure usage sync is running for this router
  const conn: RouterConnection = { host: r.host, port: r.port, username: r.username, password: r.password };
  ensureUsageSyncScheduled(id, conn);

  if (cached) {
    res.json({ ...cached.data, _cachedAt: cached.updatedAt });
  } else {
    // No cache yet — return zeros, data will arrive on next poll
    const mm = String(new Date().getMonth() + 1).padStart(2, "0");
    const y  = new Date().getFullYear();
    const d  = String(new Date().getDate()).padStart(2, "0");
    res.json({
      dailyCount: 0, dailyAmount: 0,
      yesterdayCount: 0, yesterdayAmount: 0,
      weekCount: 0, weekAmount: 0,
      lastWeekCount: 0, lastWeekAmount: 0,
      monthlyCount: 0, monthlyAmount: 0,
      lastMonthCount: 0, lastMonthAmount: 0,
      totalCount: 0, totalAmount: 0,
      dateLabel: `${y}-${mm}-${d}`, monthLabel: `${mm}${y}`, _cachedAt: null,
    });
  }
});

/**
 * GET /routers/:id/profile-stock
 * Returns per-profile ticket availability and daily sales for the gauge panel.
 * { profileName, available, soldToday }[]
 */
router.get("/routers/:id/profile-stock", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const rows = await db
    .select({
      profileName: vouchersTable.profileName,
      available:   sql<number>`cast(count(*) filter (where ${vouchersTable.usedAt} is null) as int)`,
      soldToday:   sql<number>`cast(count(*) filter (where ${vouchersTable.usedAt} >= ${startOfDay}) as int)`,
    })
    .from(vouchersTable)
    .where(eq(vouchersTable.routerId, id))
    .groupBy(vouchersTable.profileName)
    .orderBy(vouchersTable.profileName);

  res.json(rows);
});

router.get("/routers/:id/sync-status", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  const conn: RouterConnection = { host: r.host, port: r.port, username: r.username, password: r.password };
  ensureUsageSyncScheduled(id, conn);

  const entry = usageSyncCache.get(id);
  res.json({
    running:   usageSyncActive.has(id),
    updatedAt: entry?.updatedAt ?? null,
    updated:   entry?.updated  ?? 0,
    total:     entry?.total    ?? 0,
  });
});

/**
 * GET /routers/:id/sales-report
 * Serves MikHMon sales data from the local DB cache (mikrotik_script_sales).
 * Query params:
 *   ?year=2026&month=3       → monthly
 *   ?year=2026&month=3&day=5 → daily
 *   (none)                   → all history
 */
router.get("/routers/:id/sales-report", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const yearRaw  = req.query.year  ? parseInt(req.query.year  as string, 10) : null;
  const monthRaw = req.query.month ? parseInt(req.query.month as string, 10) : null;
  const dayRaw   = req.query.day   ? parseInt(req.query.day   as string, 10) : null;

  try {
    const conditions: ReturnType<typeof eq>[] = [eq(scriptSalesTable.routerId, id) as any];
    if (yearRaw)  conditions.push(sql`EXTRACT(YEAR  FROM ${scriptSalesTable.saleDate} AT TIME ZONE 'UTC') = ${yearRaw}` as any);
    if (monthRaw) conditions.push(sql`EXTRACT(MONTH FROM ${scriptSalesTable.saleDate} AT TIME ZONE 'UTC') = ${monthRaw}` as any);
    if (dayRaw)   conditions.push(sql`EXTRACT(DAY   FROM ${scriptSalesTable.saleDate} AT TIME ZONE 'UTC') = ${dayRaw}` as any);

    const rows = await db
      .select({
        date:     sql<string>`to_char(${scriptSalesTable.saleDate} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
        time:     sql<string>`to_char(${scriptSalesTable.saleDate} AT TIME ZONE 'UTC', 'HH24:MI:SS')`,
        username: scriptSalesTable.username,
        price:    scriptSalesTable.price,
        ip:       scriptSalesTable.ip,
        mac:      scriptSalesTable.mac,
        validity: scriptSalesTable.validity,
        label:    scriptSalesTable.label,
        batch:    scriptSalesTable.batch,
      })
      .from(scriptSalesTable)
      .where(and(...conditions))
      .orderBy(sql`${scriptSalesTable.saleDate} DESC`);

    const entries = rows.map(({ price, ...rest }) => ({
      ...rest,
      price: parseFloat(price) || 0,
    }));

    res.json(entries);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Erreur base de données" });
  }
});

router.get("/routers/:id/interfaces", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const ck = `interfaces:${id}`;
  const hit = mGet(ck);
  if (hit) { res.json(hit); return; }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  try {
    const conn: RouterConnection = { host: r.host, port: r.port, username: r.username, password: r.password };
    const ifaces = await listInterfaces(conn);
    mSet(ck, MIK_TTL.interfaces, ifaces);
    res.json(ifaces);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de contacter le routeur" });
  }
});

// Per-key in-flight refresh guard for short-lived caches (logs/traffic) — Mikhmon-style.
const _swrRefreshing = new Set<string>();

router.get("/routers/:id/traffic", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const ifaceName = typeof req.query.iface === "string" && req.query.iface ? req.query.iface : "";
  const ck = `traffic:${id}:${ifaceName}`;
  const fresh = mGet(ck);
  if (fresh) { res.json(fresh); return; }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }
  const conn: RouterConnection = { host: r.host, port: r.port, username: r.username, password: r.password };

  const stale = mGetStale(ck);
  if (stale) {
    res.json(stale);
    if (!_swrRefreshing.has(ck)) {
      _swrRefreshing.add(ck);
      setImmediate(async () => {
        try {
          const traffic = await fetchInterfaceTraffic(conn, ifaceName || undefined);
          mSet(ck, MIK_TTL.traffic, traffic);
        } catch { /* keep stale */ }
        finally { _swrRefreshing.delete(ck); }
      });
    }
    return;
  }

  try {
    const traffic = await fetchInterfaceTraffic(conn, ifaceName || undefined);
    mSet(ck, MIK_TTL.traffic, traffic);
    res.json(traffic);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de contacter le routeur" });
  }
});

router.get("/routers/:id/logs", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const limit  = req.query.limit  ? parseInt(req.query.limit  as string, 10) : 50;
  const topics = (req.query.topics as string | undefined) ?? "";
  const ck = `logs:${id}:${topics}:${limit}`;
  const fresh = mGet(ck);
  if (fresh) { res.json(fresh); return; }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }
  const conn = { host: r.host, port: r.port, username: r.username, password: r.password };

  const stale = mGetStale(ck);
  if (stale) {
    res.json(stale);
    if (!_swrRefreshing.has(ck)) {
      _swrRefreshing.add(ck);
      setImmediate(async () => {
        try {
          const logs = await listLogs(conn, limit, topics || undefined);
          mSet(ck, MIK_TTL.logs, logs);
        } catch { /* keep stale */ }
        finally { _swrRefreshing.delete(ck); }
      });
    }
    return;
  }

  try {
    const logs = await listLogs(conn, limit, topics || undefined);
    mSet(ck, MIK_TTL.logs, logs);
    res.json(logs);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de contacter le routeur" });
  }
});

router.post("/routers/:id/sessions/disconnect", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const { user } = req.body as { user?: string };
  if (!user) { res.status(400).json({ error: "user est requis" }); return; }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  try {
    const conn = { host: r.host, port: r.port, username: r.username, password: r.password };
    const removed = await disconnectSession(conn, user);
    res.json({ removed, user });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de contacter le routeur" });
  }
});

router.post("/routers/:id/sync", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  try {
    const conn = { host: r.host, port: r.port, username: r.username, password: r.password };
    const [users, profiles] = await Promise.all([
      listHotspotUsers(conn),
      listProfiles(conn).catch(() => []),
    ]);

    const profileMap = new Map(profiles.map((p) => [p.name, p]));

    let imported = 0;
    let skipped = 0;

    for (const user of users) {
      if (!user.username || user.username === "default" || user.username === "default-trial") {
        skipped++;
        continue;
      }

      const existing = await db
        .select({ id: vouchersTable.id })
        .from(vouchersTable)
        .where(and(eq(vouchersTable.routerId, id), eq(vouchersTable.username, user.username)))
        .limit(1);

      if (existing.length > 0) {
        skipped++;
        continue;
      }

      const prof = profileMap.get(user.profile);
      await db.insert(vouchersTable).values({
        routerId: id,
        username: user.username,
        password: user.password,
        profileName: user.profile || "default",
        price: prof?.price ?? "",
        validity: prof?.validity ?? user.limitUptime ?? "",
        comment: user.comment ?? null,
      });
      imported++;
    }

    res.json({ imported, skipped, total: users.length });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de contacter le routeur" });
  }
});

/**
 * POST /routers/:id/sync-usage
 * Immediate manual sync — runs runUsageSync synchronously, updates cache,
 * and resets the auto-sync schedule for this router.
 */
router.post("/routers/:id/sync-usage", async (req, res): Promise<void> => {
  const routerId = parseInt(req.params.id, 10);
  if (isNaN(routerId)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [routerRow] = await db
    .select()
    .from(routersTable)
    .where(eq(routersTable.id, routerId));

  if (!routerRow) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  const conn: RouterConnection = {
    host: routerRow.host,
    port: routerRow.port,
    username: routerRow.username,
    password: routerRow.password,
  };

  // If a background sync is already running, wait for it briefly or return cached
  if (usageSyncActive.has(routerId)) {
    const entry = usageSyncCache.get(routerId);
    res.json({ running: true, updated: entry?.updated ?? 0, total: entry?.total ?? 0, _cachedAt: entry?.updatedAt ?? null });
    return;
  }

  try {
    const result = await runUsageSync(routerId, conn);
    usageSyncCache.set(routerId, { updatedAt: Date.now(), ...result });
    // Reset recurring schedule
    const existing = usageSyncTimer.get(routerId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => scheduleUsageSync(routerId, conn), USAGE_SYNC_INTERVAL);
    usageSyncTimer.set(routerId, timer);
    res.json({ running: false, ...result, _cachedAt: Date.now() });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de contacter le routeur" });
  }
});

/* ── Startup cache warm-up ──────────────────────────────────────────────
 * Proactively fetch /info for all active routers right after the server
 * boots so the very first dashboard request is served from cache.
 * Failures are silently ignored — the endpoint falls back to a live call.
 */
setImmediate(async () => {
  try {
    const activeRouters = await db
      .select()
      .from(routersTable)
      .where(eq(routersTable.isActive, true));
    await Promise.all(
      activeRouters.map(async (r) => {
        const conn: RouterConnection = { host: r.host, port: r.port, username: r.username, password: r.password };
        // Warm the /info cache
        const ck = `info:${r.id}`;
        if (!mGet(ck)) {
          try {
            const info = await getRouterInfo(conn);
            mSet(ck, MIK_TTL.info, info);
          } catch { /* ignore individual router failures */ }
        }
        // Auto-start usage sync so per-vendor stats are fresh from the first request
        ensureUsageSyncScheduled(r.id, conn);
      }),
    );
  } catch { /* ignore DB errors at startup */ }
});

export default router;
