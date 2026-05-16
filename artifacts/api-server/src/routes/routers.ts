import { Router } from "express";
import { eq, and, or, inArray, isNotNull, isNull, sql, gte, lt, desc, notExists } from "drizzle-orm";
import { db, routersTable, vouchersTable, scriptSalesTable, routerProfilesSnapshotTable, adminSettingsTable, managersTable, vendorsTable, collaborateursTable, collaborateurRoutersTable, profilesCacheTable } from "@workspace/db";
import { verifyAdminTokenFull } from "../lib/admin-auth.js";
import { verifyToken as verifyManagerToken } from "../lib/manager-auth.js";
import { verifyToken as verifyVendorToken } from "../lib/vendor-auth.js";
import { verifyToken as verifyCollaborateurToken } from "../lib/collaborateur-auth.js";
import { testConnection, pingRouter, getRouterInfo, listProfiles, createProfile, updateProfile, deleteProfile, listAddressPools, listSessions, listHotspotUsers, addHotspotUser, disconnectSession, listLogs, fetchSalesFromScripts, fetchScriptSales, fetchInterfaceTraffic, listInterfaces, deleteHotspotUsersByComment, deleteHotspotUsersByNames, resetHotspotUser, listIpBindings, addIpBinding, updateIpBinding, deleteIpBinding, listHotspotServers, updateHotspotUser, upsertIpBindingQueue, removeIpBindingQueue, setIpBindingQueueDisabledByBindingId, listDhcpLeases, getIpBindingById, findIpBindingFast, resolveBindingAddressFromDhcp, listHotspotCookies, deleteHotspotCookie, deleteHotspotCookiesByUser, purgeMikhmonScriptsForMonth, rebootRouter, shutdownRouter, countSessionsFast, listHotspotUsersFast, type SalesReport, type RouterConnection } from "../lib/mikrotik.js";
import { runUsageSync } from "../lib/usage-sync.js";
import { syncScriptCache, clearRouterScriptCache } from "../lib/script-cache.js";
import { syncProfileRenames } from "../lib/vendor-sync.js";
import { withRouterLock, isRouterLocked, lockRouter, unlockRouter } from "../lib/router-lock.js";
import { logger } from "../lib/logger.js";
import { subscribeRouterPoller } from "../lib/mikrotik-poller.js";
import { aggregateVendorPeriodSales, fetchUnattributedPeriodSales } from "../lib/vendor-period-sales-aggregate.js";
import { getCachedProfilePricesSync } from "../lib/profile-cache.js";

const router = Router();
const BASE_ROUTER_SLOTS = 5;
const CREDITS_PER_EXTRA_ROUTER = 10;
const queueReconcileInFlight = new Set<string>();

interface ProfileListCache {
  profiles: Awaited<ReturnType<typeof listProfiles>>;
  expiresAt: number;
}
const profileListCache = new Map<string, ProfileListCache>();
const profileListInFlight = new Map<string, Promise<Awaited<ReturnType<typeof listProfiles>>>>();
const PROFILE_LIST_CACHE_TTL = 900_000; // 15 min

/** RAM cache key segment: tenant owner + DB row id (two rows on same MikroTik → two keys). */
export function routerCacheScope(ownerAdminId: number | null, routerId: number): string {
  const t = ownerAdminId == null ? "na" : String(ownerAdminId);
  return `${t}_${routerId}`;
}

function getFreshProfileCache(scope: string) {
  const cached = profileListCache.get(scope);
  if (cached && Date.now() < cached.expiresAt) return cached.profiles;
  return null;
}

function setProfileCache(scope: string, profiles: Awaited<ReturnType<typeof listProfiles>>) {
  profileListCache.set(scope, { profiles, expiresAt: Date.now() + PROFILE_LIST_CACHE_TTL });
}

function invalidateProfileListCache(ownerAdminId: number | null, routerId: number) {
  const scope = routerCacheScope(ownerAdminId, routerId);
  profileListCache.delete(scope);
  profileListInFlight.delete(scope);
}

/** Profile names that are internal to RouterOS / MikHmon and must never be shown or imported. */
const SYSTEM_PROFILE_NAMES = new Set(["trial", "default-trial"]);

type HotspotProfileWriteBody = {
  name: string;
  validity: string;
  price: string;
  sellingPrice: string;
  sharedUsers: string;
  addrPool: string;
  rateLimit: string;
  expiredMode: string;
  lockMac: boolean;
  parentQueue: string;
  mikrotikId?: string;
};

function isProfileExpirationModeNone(mode: string | undefined): boolean {
  const m = (mode ?? "None").trim().toLowerCase();
  return m === "none" || m === "nothing" || m === "0" || m === "-";
}

function parseHotspotProfileWriteBody(
  raw: Record<string, unknown>,
): { ok: true; body: HotspotProfileWriteBody } | { ok: false; error: string } {
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return { ok: false, error: "Le nom est obligatoire." };

  const expiredMode =
    typeof raw.expiredMode === "string" && raw.expiredMode.trim()
      ? raw.expiredMode.trim()
      : "None";
  const validityRaw = typeof raw.validity === "string" ? raw.validity.trim() : "";

  return {
    ok: true,
    body: {
      name,
      validity: isProfileExpirationModeNone(expiredMode) ? "" : validityRaw,
      price: typeof raw.price === "string" ? raw.price.trim() : "",
      sellingPrice: typeof raw.sellingPrice === "string" ? raw.sellingPrice.trim() : "",
      sharedUsers:
        typeof raw.sharedUsers === "string" && raw.sharedUsers.trim()
          ? raw.sharedUsers.trim()
          : "1",
      addrPool: typeof raw.addrPool === "string" ? raw.addrPool.trim() : "",
      rateLimit: typeof raw.rateLimit === "string" ? raw.rateLimit.trim() : "",
      expiredMode,
      lockMac: raw.lockMac === true,
      parentQueue: typeof raw.parentQueue === "string" ? raw.parentQueue.trim() : "",
      mikrotikId:
        typeof raw.mikrotikId === "string" && raw.mikrotikId.trim()
          ? raw.mikrotikId.trim()
          : undefined,
    },
  };
}

/** Returns true if the user is a regular voucher user (not a system/demo account). */
function isRealUser(u: { username: string; profile: string }): boolean {
  const uname = u.username.toLowerCase();
  const prof  = (u.profile ?? "").toLowerCase();
  return uname !== "default" && uname !== "default-trial" && !SYSTEM_PROFILE_NAMES.has(prof);
}

async function fetchProfilesWithCache(ownerAdminId: number | null, routerId: number, conn: RouterConnection) {
  const scope = routerCacheScope(ownerAdminId, routerId);
  const inFlight = profileListInFlight.get(scope);
  if (inFlight) return inFlight;

  const task = listProfiles(conn)
    .then((profiles) => {
      const filtered = profiles.filter((p) => !SYSTEM_PROFILE_NAMES.has(p.name.toLowerCase()));
      setProfileCache(scope, filtered);
      return filtered;
    })
    .finally(() => {
      profileListInFlight.delete(scope);
    });

  profileListInFlight.set(scope, task);
  return task;
}

/* ── Generic in-memory TTL cache for MikroTik live-data endpoints ───────
 *
 * Key format: "<type>:<owner>_<routerId>"  or  "<type>:<owner>_<routerId>:<extra>"
 * TTLs are chosen so the UI feels instant while data stays acceptably fresh.
 *
 *   ping        30 s  — status probe, polled often by dashboard
 *   info        60 s  — uptime/resources, 1 min staleness acceptable
 *   pools        5 min — address pools rarely change
 *   sessions    15 s  — active hotspot sessions
 *   interfaces   5 min — interface list rarely changes
 *   traffic      2 s   — near-live chart without 1s overload
 *   logs        10 s  — system log tail
 */
const _mik = new Map<string, { data: unknown; exp: number }>();
function mGet(k: string) { const e = _mik.get(k); return (e && Date.now() < e.exp) ? e.data : null; }
/** Returns cached data even if expired (stale-while-revalidate pattern). */
function mGetStale(k: string) { return _mik.get(k)?.data ?? null; }
function mSet(k: string, ttl: number, d: unknown) { _mik.set(k, { data: d, exp: Date.now() + ttl }); }

function purgeMikKeysForScope(scope: string): void {
  const simple = ["ping", "info", "pools", "sessions", "leases", "interfaces"] as const;
  for (const p of simple) {
    _mik.delete(`${p}:${scope}`);
  }
  for (const k of [..._mik.keys()]) {
    if (k.startsWith(`traffic:${scope}:`) || k.startsWith(`logs:${scope}:`)) {
      _mik.delete(k);
    }
  }
}

const MIK_TTL = {
  ping:       10_000,
  info:        8_000,
  pools:     300_000,
  sessions:   15_000,
  interfaces:300_000,
  traffic:     2_000,
  logs:        4_000,
  leases:     20_000,
} as const;

function foldText(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Decode the admin token (if present and valid) so we can scope this request
 * to the caller's tenant. Returns null when there is no admin token (e.g. a
 * manager / vendor / collaborateur is calling). The endpoints that strictly
 * require an admin handle the auth refusal themselves.
 */
function getAdminScopeFromHeader(req: { headers: { authorization?: string } }): { adminId: number; isSuperAdmin: boolean; isImpersonating?: boolean } | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  return verifyAdminTokenFull(auth.slice(7));
}

/** JWT `adminId` must exist in `admin_settings` (évite erreur 500 FK après changement de base / reseed). */
async function adminTenantExists(adminId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: adminSettingsTable.id })
    .from(adminSettingsTable)
    .where(eq(adminSettingsTable.id, adminId));
  return !!row;
}

const ERR_SESSION_DB_MISMATCH =
  "Session invalide pour cette base de données. Déconnectez-vous puis reconnectez-vous.";

/**
 * Resolve the caller into a list of routerIds they are permitted to access
 * AND the tenant (ownerAdminId) they belong to. Returns null when the request
 * carries no recognized token at all.
 *
 *   - super-admin           → { kind: "super",   adminId }    (own routers only, same tenant rule as admin)
 *   - regular admin         → { kind: "admin",   adminId,    routerIds }
 *   - manager/vendor/collab → { kind: "<role>",  adminId?,   routerIds }
 *
 * `adminId` for non-super callers is the tenant they belong to.
 * `routerIds` is the exact set of routers the caller is allowed to touch.
 */
export type CallerScope =
  | { kind: "super"; adminId: number }
  | { kind: "admin"; adminId: number; routerIds: number[] }
  | { kind: "manager"; adminId: number | null; routerIds: number[] }
  | { kind: "vendor"; adminId: number | null; routerIds: number[] }
  | { kind: "collaborateur"; adminId: number | null; routerIds: number[] };

export async function resolveCallerScope(req: {
  headers: { authorization?: string };
  query?: Record<string, unknown>;
}): Promise<CallerScope | null> {
  const headerToken = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : null;
  const queryToken = typeof req.query?.token === "string" ? req.query.token : null;
  const token = headerToken ?? queryToken;
  if (!token) return null;

  // Try admin token first (super-admin or regular admin).
  const adminScope = verifyAdminTokenFull(token);
  if (adminScope) {
    if (adminScope.isSuperAdmin) return { kind: "super", adminId: adminScope.adminId };
    const ownedRouters = await db
      .select({ id: routersTable.id })
      .from(routersTable)
      .where(eq(routersTable.ownerAdminId, adminScope.adminId));
    return {
      kind: "admin",
      adminId: adminScope.adminId,
      routerIds: ownedRouters.map((r) => r.id),
    };
  }

  // Try manager token.
  const mgr = verifyManagerToken(token);
  if (mgr) {
    const [row] = await db
      .select({
        ownerAdminId: managersTable.ownerAdminId,
        routerId:     managersTable.routerId,
        isActive:     managersTable.isActive,
      })
      .from(managersTable)
      .where(eq(managersTable.id, mgr.managerId));
    if (!row || !row.isActive) return null;
    // Locked manager → only the assigned router.
    // Unlocked manager (routerId == null) → all routers in their tenant.
    let routerIds: number[];
    if (row.routerId !== null) {
      routerIds = [row.routerId];
    } else if (row.ownerAdminId !== null) {
      const ownerRouters = await db
        .select({ id: routersTable.id })
        .from(routersTable)
        .where(eq(routersTable.ownerAdminId, row.ownerAdminId));
      routerIds = ownerRouters.map((r) => r.id);
    } else {
      routerIds = [];
    }
    return {
      kind: "manager",
      adminId: row.ownerAdminId,
      routerIds,
    };
  }

  // Try vendor token.
  const vnd = verifyVendorToken(token);
  if (vnd) {
    const [row] = await db
      .select({
        ownerAdminId: vendorsTable.ownerAdminId,
        routerId:     vendorsTable.routerId,
        isActive:     vendorsTable.isActive,
      })
      .from(vendorsTable)
      .where(eq(vendorsTable.id, vnd.vendorId));
    if (!row || !row.isActive) return null;
    return {
      kind: "vendor",
      adminId: row.ownerAdminId,
      routerIds: row.routerId !== null ? [row.routerId] : [],
    };
  }

  // Try collaborateur token.
  const col = verifyCollaborateurToken(token);
  if (col) {
    // Refuse disabled collaborateurs even if their token is still valid.
    const [colRow] = await db
      .select({
        ownerAdminId: collaborateursTable.ownerAdminId,
        isActive:     collaborateursTable.isActive,
      })
      .from(collaborateursTable)
      .where(eq(collaborateursTable.id, col.collaborateurId));
    if (!colRow || !colRow.isActive) return null;
    // Re-derive the assignment from the DB — never trust the token-embedded
    // routerIds without a sanity check against current assignments.
    const rows = await db
      .select({ routerId: collaborateurRoutersTable.routerId })
      .from(collaborateurRoutersTable)
      .where(eq(collaborateurRoutersTable.collaborateurId, col.collaborateurId));
    const dbRouterIds = rows.map((r) => r.routerId);
    return {
      kind: "collaborateur",
      adminId: colRow.ownerAdminId,
      routerIds: dbRouterIds,
    };
  }

  return null;
}

router.get("/routers", async (req, res): Promise<void> => {
  const scope = await resolveCallerScope(req);
  if (!scope) { res.status(401).json({ error: "Non authentifié" }); return; }

  if (scope.kind === "super" || scope.kind === "admin") {
    if (!(await adminTenantExists(scope.adminId))) {
      res.status(401).json({ error: ERR_SESSION_DB_MISMATCH });
      return;
    }
  }

  const baseSelect = db
    .select({
      id: routersTable.id,
      name: routersTable.name,
      hotspotName: routersTable.hotspotName,
      contact: routersTable.contact,
      currency: routersTable.currency,
      host: routersTable.host,
      port: routersTable.port,
      username: routersTable.username,
      password: routersTable.password,
      autoDeleteSalesScripts: routersTable.autoDeleteSalesScripts,
      isActive: routersTable.isActive,
      ownerAdminId: routersTable.ownerAdminId,
      createdAt: routersTable.createdAt,
      updatedAt: routersTable.updatedAt,
    })
    .from(routersTable);




  // Super-admin et admin normal : routeurs du tenant (owner_admin_id).
  // Super-admin seul sur la plateforme : inclure les routeurs legacy sans owner_admin_id.
  // Le super-admin accède aux routeurs des autres via /api/super/admins/:id/routers.
  if (scope.kind === "super" || scope.kind === "admin") {
    let ownerCond = eq(routersTable.ownerAdminId, scope.adminId);
    if (scope.kind === "super") {
      const [{ c }] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(adminSettingsTable)
        .where(eq(adminSettingsTable.isSuperAdmin, true));
      if (Number(c) === 1) {
        ownerCond = or(eq(routersTable.ownerAdminId, scope.adminId), isNull(routersTable.ownerAdminId))!;
      }
    }
    res.json(await baseSelect.where(ownerCond).orderBy(routersTable.name));
    return;
  }
  // manager / vendor / collaborateur: only the routers they're assigned to.
  if (scope.routerIds.length === 0) { res.json([]); return; }
  res.json(await baseSelect.where(inArray(routersTable.id, scope.routerIds)).orderBy(routersTable.name));
});

router.post("/routers", async (req, res): Promise<void> => {
  const scope = getAdminScopeFromHeader(req);
  if (!scope) { res.status(401).json({ error: "Non authentifié" }); return; }

  if (!(await adminTenantExists(scope.adminId))) {
    res.status(401).json({ error: ERR_SESSION_DB_MISMATCH });
    return;
  }

  const { name, hotspotName, contact, currency, host, port, username, password, autoDeleteSalesScripts, isActive } = req.body as {
    name?: string;
    hotspotName?: string;
    contact?: string;
    currency?: string;
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    autoDeleteSalesScripts?: boolean;
    isActive?: boolean;
  };

  if (!name || !host || !username || !password) {
    res.status(400).json({ error: "name, host, username et password sont requis" });
    return;
  }

  // Quota enforcement (regular admins only). The super-admin bypasses the
  // limit because they manage all tenants.
  if (!scope.isSuperAdmin) {
    const [adminRow] = await db
      .select({
        extraRouterSlots: adminSettingsTable.extraRouterSlots,
        isActive:         adminSettingsTable.isActive,
      })
      .from(adminSettingsTable)
      .where(eq(adminSettingsTable.id, scope.adminId));
    if (!adminRow || !adminRow.isActive) {
      res.status(403).json({ error: "Compte désactivé" });
      return;
    }
    const limit = BASE_ROUTER_SLOTS + adminRow.extraRouterSlots;
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(routersTable)
      .where(eq(routersTable.ownerAdminId, scope.adminId));
    if (Number(count) >= limit) {
      const autoExpanded = await db
        .update(adminSettingsTable)
        .set({
          credits: sql`${adminSettingsTable.credits} - ${CREDITS_PER_EXTRA_ROUTER}`,
          extraRouterSlots: sql`${adminSettingsTable.extraRouterSlots} + 1`,
        })
        .where(and(
          eq(adminSettingsTable.id, scope.adminId),
          sql`${adminSettingsTable.credits} >= ${CREDITS_PER_EXTRA_ROUTER}`,
        ))
        .returning({ id: adminSettingsTable.id });
      if (autoExpanded.length === 0) {
        res.status(402).json({
          error: `Limite atteinte (${limit} routeur${limit > 1 ? "s" : ""}). Crédit insuffisant: ${CREDITS_PER_EXTRA_ROUTER} requis pour ajouter 1 routeur.`,
          routerCount: Number(count),
          routerLimit: limit,
        });
        return;
      }
    }
  }

  const currencyNorm = (currency ?? "FCFA").trim().slice(0, 24) || "FCFA";

  const [created] = await db
    .insert(routersTable)
    .values({
      // Super-admin-created routers default to the super-admin's tenant.
      ownerAdminId: scope.adminId,
      name,
      hotspotName: hotspotName ?? null,
      contact: contact ?? null,
      currency: currencyNorm,
      host,
      port: port ?? 8728,
      username,
      password,
      autoDeleteSalesScripts: autoDeleteSalesScripts ?? false,
      isActive: isActive ?? true,
    })
    .returning({
      id: routersTable.id,
      name: routersTable.name,
      hotspotName: routersTable.hotspotName,
      contact: routersTable.contact,
      currency: routersTable.currency,
      host: routersTable.host,
      port: routersTable.port,
      username: routersTable.username,
      autoDeleteSalesScripts: routersTable.autoDeleteSalesScripts,
      isActive: routersTable.isActive,
      ownerAdminId: routersTable.ownerAdminId,
      createdAt: routersTable.createdAt,
      updatedAt: routersTable.updatedAt,
    });

  res.status(201).json(created);
});

/**
 * Tenant-isolation middleware for every /routers/:id and /routers/:id/* route.
 *
 * Rules:
 *   - No recognized token  → 401
 *   - Super-admin          → router must belong to them (ownerAdminId === leur id)
 *   - Regular admin        → router must belong to their tenant (ownerAdminId)
 *   - Manager / vendor     → router id must equal their assigned routerId
 *   - Collaborateur        → router id must be in their assigned routerIds set
 */
router.use("/routers/:id", async (req, res, next) => {
  const scope = await resolveCallerScope(req);
  if (!scope) { res.status(401).json({ error: "Non authentifié" }); return; }

  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (Number.isNaN(id)) { next(); return; } // let the handler report a clean 400

  // Super-admin peut accéder à n'importe quel routeur sans restriction de tenant.
  if (scope.kind === "super") {
    const [r] = await db
      .select({ owner: routersTable.ownerAdminId })
      .from(routersTable)
      .where(eq(routersTable.id, id));
    if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }
    next();
    return;
  }

  if (scope.kind === "admin") {
    const [r] = await db
      .select({ owner: routersTable.ownerAdminId })
      .from(routersTable)
      .where(eq(routersTable.id, id));
    if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }
    if (r.owner == null) {
      res.status(403).json({
        error:
          "Ce routeur n'est pas rattaché à un compte client (propriétaire manquant). Ouvrez Super administrateur → Administrateurs → Routeurs du client, ou réattribuez le routeur.",
      });
      return;
    }
    if (r.owner !== scope.adminId) {
      res.status(403).json({ error: "Accès refusé à ce routeur" });
      return;
    }
    next();
    return;
  }

  // manager / vendor / collaborateur — must be in their assigned set.
  if (!scope.routerIds.includes(id)) {
    res.status(403).json({ error: "Accès refusé à ce routeur" });
    return;
  }
  next();
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
      currency: routersTable.currency,
      host: routersTable.host,
      port: routersTable.port,
      username: routersTable.username,
      autoDeleteSalesScripts: routersTable.autoDeleteSalesScripts,
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

  const { name, hotspotName, contact, currency, host, port, username, password, autoDeleteSalesScripts, isActive } = req.body as {
    name?: string;
    hotspotName?: string;
    contact?: string;
    currency?: string;
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    autoDeleteSalesScripts?: boolean;
    isActive?: boolean;
  };

  const updates: Partial<typeof routersTable.$inferInsert> = {};
  if (name !== undefined) updates.name = name;
  if (hotspotName !== undefined) updates.hotspotName = hotspotName || null;
  if (contact !== undefined) updates.contact = contact || null;
  if (currency !== undefined) {
    const c = currency.trim().slice(0, 24);
    updates.currency = c || "FCFA";
  }
  if (host !== undefined) updates.host = host;
  if (port !== undefined) updates.port = port;
  if (username !== undefined) updates.username = username;
  // Chaîne vide = "ne pas changer le mot de passe" (cas édition sans modification)
  if (password !== undefined && password !== "") updates.password = password;
  if (autoDeleteSalesScripts !== undefined) updates.autoDeleteSalesScripts = autoDeleteSalesScripts;
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
      ownerAdminId: routersTable.ownerAdminId,
      name: routersTable.name,
      hotspotName: routersTable.hotspotName,
      contact: routersTable.contact,
      currency: routersTable.currency,
      host: routersTable.host,
      port: routersTable.port,
      username: routersTable.username,
      autoDeleteSalesScripts: routersTable.autoDeleteSalesScripts,
      isActive: routersTable.isActive,
      createdAt: routersTable.createdAt,
      updatedAt: routersTable.updatedAt,
    });

  if (!updated) { res.status(404).json({ error: "Routeur introuvable" }); return; }
  purgeRouterRowVolatileCaches(updated.ownerAdminId, updated.id);
  res.json(updated);
});

router.delete("/routers/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [deleted] = await db.delete(routersTable).where(eq(routersTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Routeur introuvable" }); return; }
  purgeRouterRowVolatileCaches(deleted.ownerAdminId, deleted.id);
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

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }
  const sc = routerCacheScope(r.ownerAdminId, id);
  const ck = `ping:${sc}`;
  const force = req.query.force === "1";
  if (!force) {
    const hit = mGet(ck);
    if (hit) { res.json(hit); return; }
  }

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

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }
  const sc = routerCacheScope(r.ownerAdminId, id);
  const ck = `info:${sc}`;

  // Fresh hit — return immediately
  const fresh = mGet(ck);
  if (fresh) { res.json(fresh); return; }

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
  const pScope = routerCacheScope(r.ownerAdminId, id);
  const freshCached = getFreshProfileCache(pScope);
  const forceRefresh = String(req.query.refresh ?? "") === "1";
  const staleCached = profileListCache.get(pScope)?.profiles ?? null;

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
    if (forceRefresh) void fetchProfilesWithCache(r.ownerAdminId, id, conn).then(saveSnapshot).catch(() => undefined);
    res.json(freshCached);
    return;
  }
  if (staleCached) {
    // Stale-while-revalidate: return instantly, refresh in background.
    void fetchProfilesWithCache(r.ownerAdminId, id, conn).then(saveSnapshot).catch(() => undefined);
    res.json(staleCached);
    return;
  }

  // Cache is empty (first request after server start).
  // Try MikroTik; on failure fall back to DB snapshot so the UI is never blank.
  try {
    const fetched = await fetchProfilesWithCache(r.ownerAdminId, id, conn);
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

  const parsed = parseHotspotProfileWriteBody(
    (req.body ?? {}) as Record<string, unknown>,
  );
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  try {
    await createProfile(
      { host: r.host, port: r.port, username: r.username, password: r.password },
      parsed.body,
    );
    invalidateProfileListCache(r.ownerAdminId, id);
    // Pré-chauffer le cache profil en background : quand le frontend refetch juste
    // après, la liste est déjà prête en RAM — zéro roundtrip MikroTik supplémentaire.
    void fetchProfilesWithCache(r.ownerAdminId, id, { host: r.host, port: r.port, username: r.username, password: r.password }).catch(() => undefined);
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

  const parsed = parseHotspotProfileWriteBody(
    (req.body ?? {}) as Record<string, unknown>,
  );
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  try {
    await updateProfile(
      { host: r.host, port: r.port, username: r.username, password: r.password },
      originalName,
      parsed.body,
    );
    invalidateProfileListCache(r.ownerAdminId, id);
    void fetchProfilesWithCache(r.ownerAdminId, id, { host: r.host, port: r.port, username: r.username, password: r.password }).catch(() => undefined);
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
    invalidateProfileListCache(r.ownerAdminId, id);
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
    invalidateProfileListCache(r.ownerAdminId, id);
    void fetchProfilesWithCache(r.ownerAdminId, id, { host: r.host, port: r.port, username: r.username, password: r.password }).catch(() => undefined);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de supprimer le profil" });
  }
});

router.get("/routers/:id/pools", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }
  const sc = routerCacheScope(r.ownerAdminId, id);
  const ck = `pools:${sc}`;
  const hit = mGet(ck);
  if (hit) { res.json(hit); return; }

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

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }
  const sc = routerCacheScope(r.ownerAdminId, id);
  const ck = `sessions:${sc}`;
  const hit = mGet(ck);
  if (hit) { res.json(hit); return; }

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
const _sessionsRefreshing     = new Set<number>();
const _sessionsFastRefreshing = new Set<number>();
const _sessionsFastCount      = new Map<string, { count: number; cachedAt: number }>();
const _infoRefreshing         = new Set<number>();
router.get("/routers/:id/sessions/count", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }
  const sc = routerCacheScope(r.ownerAdminId, id);
  const ck = `sessions:${sc}`;
  const fresh = mGet(ck) as unknown[] | null;
  if (fresh) { res.json({ count: fresh.length, cached: true }); return; }

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
const userCache = new Map<string, UserCache>();
const USER_CACHE_TTL = 300_000; // 5 min — large enough so frontend never expires first

async function getCachedUsers(
  router: { id: number; ownerAdminId: number | null },
  conn: Parameters<typeof listHotspotUsers>[0],
  opts: { force?: boolean } = {},
) {
  const scope = routerCacheScope(router.ownerAdminId, router.id);
  const cached = userCache.get(scope);
  if (!opts.force && cached && Date.now() < cached.expiresAt) return cached.users;
  const users = (await listHotspotUsers(conn, 60_000)).filter(isRealUser);
  userCache.set(scope, { users, expiresAt: Date.now() + USER_CACHE_TTL });
  return users;
}

/** Call this after any action that modifies hotspot users (disable/enable/reset/delete/rename). */
export async function invalidateUserCache(routerId: number): Promise<void> {
  const [row] = await db
    .select({ o: routersTable.ownerAdminId })
    .from(routersTable)
    .where(eq(routersTable.id, routerId));
  if (!row) return;
  const scope = routerCacheScope(row.o, routerId);
  userCache.delete(scope);
  _usersCountCache.delete(scope);
}

/**
 * Surgically patch a single user in the cache instead of invalidating it.
 * Used by reset/rename to avoid a full re-fetch of thousands of users.
 * Returns true if a row was patched.
 */
/** Met à jour `disabled` dans le cache mémoire (évite un print complet après toggle). */
/** Met à jour `disabled` pour tous les users du cache dont le commentaire = lot. */
export function patchCachedHotspotUsersDisabledByComment(
  ownerAdminId: number | null,
  routerId: number,
  comment: string,
  disabled: boolean,
): boolean {
  const scope = routerCacheScope(ownerAdminId, routerId);
  const cached = userCache.get(scope);
  if (!cached) return false;
  const want = comment.trim();
  if (!want) return false;
  let patched = false;
  for (const u of cached.users) {
    if ((u.comment ?? "").trim() === want) {
      u.disabled = disabled;
      patched = true;
    }
  }
  if (patched) {
    const cnt = _usersCountCache.get(scope);
    if (cnt) cnt.cachedAt = Date.now();
  }
  return patched;
}

export function patchCachedHotspotUsersDisabled(
  ownerAdminId: number | null,
  routerId: number,
  usernames: string[],
  disabled: boolean,
): boolean {
  const scope = routerCacheScope(ownerAdminId, routerId);
  let patched = false;
  for (const u of usernames) {
    if (patchCachedUser(scope, u, { disabled })) patched = true;
  }
  return patched;
}

function patchCachedUser(
  scope: string,
  username: string,
  patch: Partial<Awaited<ReturnType<typeof listHotspotUsers>>[number]>,
): boolean {
  const cached = userCache.get(scope);
  if (!cached) return false;
  const target = username.toLowerCase();
  for (const u of cached.users) {
    if (u.username.toLowerCase() === target) {
      Object.assign(u, patch);
      // The /count payload depends on usedSet from DB, not on user fields we
      // just patched, so leave it alone — but we do bump cachedAt so it
      // doesn't look "stale" to the next reader.
      const cnt = _usersCountCache.get(scope);
      if (cnt) cnt.cachedAt = Date.now();
      return true;
    }
  }
  return false;
}

/**
 * Surgically remove users from the cache by username instead of invalidating.
 * The next /users request is served instantly from the patched cache.
 */
function removeCachedUsersByNames(scope: string, usernames: string[]): void {
  const cached = userCache.get(scope);
  if (!cached) return;
  const target = new Set(usernames.map((u) => u.toLowerCase()));
  cached.users = cached.users.filter((u) => !target.has(u.username.toLowerCase()));
  _usersCountCache.delete(scope);
}

/**
 * Surgically remove users from the cache by comment instead of invalidating.
 */
function removeCachedUsersByComment(scope: string, comment: string): void {
  const cached = userCache.get(scope);
  if (!cached) return;
  cached.users = cached.users.filter((u) => (u.comment ?? "") !== comment);
  _usersCountCache.delete(scope);
}

/**
 * Inject freshly-generated users into the cache without invalidation.
 * Called after voucher generation so that subsequent /users and /lots
 * requests are served instantly from memory (no MikroTik round-trip needed).
 * No-op when the cache entry is absent (first cold load).
 */
export function appendCachedUsers(
  routerId: number,
  ownerAdminId: number | null,
  newUsers: Awaited<ReturnType<typeof listHotspotUsers>>,
): void {
  const scope = routerCacheScope(ownerAdminId, routerId);
  const cached = userCache.get(scope);
  if (!cached) return;
  cached.users.push(...newUsers);
  _usersCountCache.delete(scope);
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
const _usersCountCache = new Map<string, UsersCountPayload>();

/** Une tâche de fond par routeur : recharge MikroTik (si demandé) + recompte les totaux DB. */
function scheduleUserCacheAndCountRefresh(
  id: number,
  ownerAdminId: number | null,
  conn: Parameters<typeof listHotspotUsers>[0],
  mikrotikForce: boolean,
): void {
  if (_usersRefreshing.has(id)) return;
  _usersRefreshing.add(id);
  setImmediate(async () => {
    try {
      const users = await getCachedUsers({ id, ownerAdminId }, conn, { force: mikrotikForce });
      const sc = routerCacheScope(ownerAdminId, id);
      const payload = await computeUsersCount(id, conn, users);
      _usersCountCache.set(sc, payload);
    } catch {
      /* keep stale */
    } finally {
      _usersRefreshing.delete(id);
    }
  });
}

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
  const sc = routerCacheScope(r.ownerAdminId, id);

  const userHit = userCache.get(sc);
  const userFresh = !!userHit && Date.now() < userHit.expiresAt;
  const cachedPayload = _usersCountCache.get(sc);

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
    scheduleUserCacheAndCountRefresh(id, r.ownerAdminId, conn, !userFresh);
    return;
  }

  // Cold start — must block to compute the very first payload
  try {
    const users = await getCachedUsers({ id, ownerAdminId: r.ownerAdminId }, conn);
    const payload = await computeUsersCount(id, conn, users);
    _usersCountCache.set(sc, payload);
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
    const sc = routerCacheScope(r.ownerAdminId, id);
    const hit = userCache.get(sc);
    const userFresh = !!hit && Date.now() < hit.expiresAt;
    const force = refresh === "1" || refresh === "true";

    let users: Awaited<ReturnType<typeof listHotspotUsers>>;
    if (force) {
      users = await getCachedUsers({ id, ownerAdminId: r.ownerAdminId }, conn, { force: true });
    } else if (hit && userFresh) {
      users = hit.users;
    } else if (hit && !userFresh) {
      users = hit.users;
      scheduleUserCacheAndCountRefresh(id, r.ownerAdminId, conn, true);
    } else {
      users = await getCachedUsers({ id, ownerAdminId: r.ownerAdminId }, conn);
    }

    if (search) {
      const q = foldText(search);
      users = users.filter(
        (u) =>
          foldText(u.username).includes(q) ||
          foldText(u.password).includes(q) ||
          foldText(u.comment ?? "").includes(q) ||
          foldText(u.profile).includes(q),
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
    await invalidateUserCache(id);
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
    const sc = routerCacheScope(r.ownerAdminId, id);
    const hit = userCache.get(sc);
    const userFresh = !!hit && Date.now() < hit.expiresAt;

    const usersPromise: Promise<Awaited<ReturnType<typeof listHotspotUsers>>> =
      hit && userFresh
        ? Promise.resolve(hit.users)
        : hit && !userFresh
          ? (() => {
              scheduleUserCacheAndCountRefresh(id, r.ownerAdminId, conn, true);
              return Promise.resolve(hit.users);
            })()
          : getCachedUsers({ id, ownerAdminId: r.ownerAdminId }, conn);

    const [users, soldRows] = await Promise.all([
      usersPromise,
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

    const map = new Map<string, { count: number; disabledCount: number; profiles: Set<string>; preview: typeof users }>();
    for (const u of users) {
      // Skip used vouchers: MAC address = currently in use on MikroTik, or tracked as used in DB
      if (u.macAddress || soldSet.has(u.username.toLowerCase())) continue;
      // Skip trial profile — internal/demo accounts, not real batches
      if (u.profile?.toLowerCase() === "trial" || u.profile?.toLowerCase() === "default-trial") continue;
      const key = u.comment ?? "";
      if (!isValidBatchComment(key)) continue;
      const entry = map.get(key) ?? { count: 0, disabledCount: 0, profiles: new Set(), preview: [] };
      entry.count++;
      if (u.disabled) entry.disabledCount++;
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
        disabledCount: data.disabledCount,
        /** Tous les comptes du lot sont désactivés sur MikroTik */
        allDisabled: data.count > 0 && data.disabledCount === data.count,
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
    // Patch cache surgically: remove only the deleted users so the next
    // frontend refetch is served instantly from memory (no MikroTik round-trip).
    const cacheScope = routerCacheScope(r.ownerAdminId, id);
    if (commentFilter) {
      removeCachedUsersByComment(cacheScope, commentFilter);
    } else if (Array.isArray(usernames) && usernames.length > 0) {
      removeCachedUsersByNames(cacheScope, usernames);
    }
    res.json({ deleted });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de contacter le routeur" });
  }
});

// PATCH /routers/:id/users/:username — rename a hotspot user

function stripIpBindingStructuralTags(comment: string | null | undefined): string {
  if (!comment) return "";
  return comment
    .replace(/\s*\[Expire le:[^\]]+\]\s*/g, "")
    .replace(/\s*\[Up:[^\]]+\]\s*/gi, "")
    .replace(/\s*\[Down:[^\]]+\]\s*/gi, "")
    .replace(/\s*\[vnetqu:[^\]]+\]\s*/g, "")
    .replace(/\s*\[vnetqd:[^\]]+\]\s*/g, "")
    .replace(/\s*\[vnetbp:[^\]]+\]\s*/g, "")
    .trim();
}

function extractQueueLimit(comment: string | null | undefined, kind: "up" | "down"): string {
  if (!comment) return "";
  const modern = kind === "up" ? /\[Up:([^\]]+)\]/i : /\[Down:([^\]]+)\]/i;
  const legacy = kind === "up" ? /\[vnetqu:([^\]]+)\]/ : /\[vnetqd:([^\]]+)\]/;
  return comment.match(modern)?.[1]?.trim() ?? comment.match(legacy)?.[1]?.trim() ?? "";
}

async function syncQueueForBinding(conn: RouterConnection, binding: Awaited<ReturnType<typeof listIpBindings>>[number]) {
  const up = extractQueueLimit(binding.comment, "up");
  const down = extractQueueLimit(binding.comment, "down");
  const hasLimit = !!(up || down);
  // Apply immediately from current binding state (Mikhmon-like direct action).
  await upsertIpBindingQueue(conn, binding, up, down);

  // Background reconcile: if DHCP IP changed (or was missing), update binding
  // and re-apply queue without blocking the user action.
  if (!hasLimit || !binding.macAddress?.trim()) return;
  const key = `${conn.host}:${conn.port}:${binding.id}`;
  if (queueReconcileInFlight.has(key)) return;
  queueReconcileInFlight.add(key);
  void (async () => {
    try {
      const ip = await resolveBindingAddressFromDhcp(conn, binding).catch(() => null);
      if (!ip) return;
      if ((binding.address ?? "").trim() !== ip) {
        await updateIpBinding(conn, binding.id, { address: ip }).catch(() => undefined);
      }
      await upsertIpBindingQueue(conn, { ...binding, address: ip }, up, down).catch(() => undefined);
    } finally {
      queueReconcileInFlight.delete(key);
    }
  })();
}

async function triggerQueueSyncForBindingId(routerId: number, conn: RouterConnection, bindingId: string): Promise<void> {
  const t0 = Date.now();
  try {
    const current = await getIpBindingById(conn, bindingId);
    if (current) await syncQueueForBinding(conn, current);
    logger.info({
      scope: "queue-sync",
      kind: "update",
      routerId,
      bindingId,
      found: !!current,
      elapsedMs: Date.now() - t0,
    }, "queue sync completed");
  } catch (err) {
    logger.warn({ scope: "queue-sync", kind: "update", routerId, bindingId, err }, "queue sync failed");
  }
}

async function triggerQueueSyncForCreatedBinding(
  routerId: number,
  conn: RouterConnection,
  parsed: { macAddress?: string; address?: string },
): Promise<void> {
  const t0 = Date.now();
  try {
    const created = await findIpBindingFast(conn, parsed);
    if (created) await syncQueueForBinding(conn, created);
    logger.info({
      scope: "queue-sync",
      kind: "create",
      routerId,
      bindingId: created?.id ?? null,
      elapsedMs: Date.now() - t0,
    }, "queue sync completed");
  } catch (err) {
    logger.warn({ scope: "queue-sync", kind: "create", routerId, err }, "queue sync failed");
  }
}

async function triggerQueueDeleteForBinding(
  routerId: number,
  conn: RouterConnection,
  binding: { id: string },
): Promise<void> {
  const t0 = Date.now();
  try {
    await removeIpBindingQueue(conn, binding);
    logger.info({
      scope: "queue-sync",
      kind: "delete",
      routerId,
      bindingId: binding.id,
      elapsedMs: Date.now() - t0,
    }, "queue sync completed");
  } catch (err) {
    logger.warn({ scope: "queue-sync", kind: "delete", routerId, bindingId: binding.id, err }, "queue sync failed");
  }
}

function extractLinkedUsername(comment: string | null | undefined): string | null {
  if (!comment) return null;
  const cleaned = stripIpBindingStructuralTags(comment);
  const legacy = cleaned.match(/^auto-bypass:user:(.+)$/i)?.[1]?.trim();
  if (legacy) return legacy;
  const m = cleaned.match(/\(([^()]+)\)\s*$/);
  const candidate = m?.[1]?.trim();
  return candidate ? candidate : null;
}

function stripLinkedSuffix(comment: string | null | undefined): string {
  if (!comment) return "";
  if (/^auto-bypass:user:/i.test(comment.trim())) return "";
  let s = stripIpBindingStructuralTags(comment);
  return s.replace(/\s*\([^()]+\)\s*$/, "").trim();
}

function buildLinkedBypassComment(baseComment: string | null | undefined, username: string): string {
  const base = stripLinkedSuffix(baseComment);
  const u = username.trim();
  if (!u) return base;
  return base ? `${base} (${u})` : `(${u})`;
}

function parseExpiryFromComment(comment: string | null | undefined): Date | null {
  if (!comment) return null;
  const m1 = comment.match(/([a-z]{3}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2}(?::\d{2})?)/i);
  if (m1) {
    const d = new Date(`${m1[1]} ${m1[2]}`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const m2 = comment.match(/(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}(?::\d{2})?)/);
  if (m2) {
    const d = new Date(`${m2[1]}T${m2[2]}`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

async function upsertLinkedBypass(
  conn: RouterConnection,
  username: string,
  macAddress: string,
  comment: string | null,
  preferredBypassComment?: string | null,
) {
  const uname = username.trim();
  const unameLower = uname.toLowerCase();
  const expired = (() => {
    const exp = parseExpiryFromComment(comment);
    return exp ? exp.getTime() <= Date.now() : false;
  })();

  const all = await listIpBindings(conn);
  const macNorm = macAddress.trim().toUpperCase();
  const existing = all.find((b) => (b.macAddress ?? "").trim().toUpperCase() === macNorm)
    ?? all.find((b) => (extractLinkedUsername(b.comment)?.toLowerCase() ?? "") === unameLower);
  const baseComment = stripLinkedSuffix(existing?.comment ?? preferredBypassComment ?? "");
  const finalComment = buildLinkedBypassComment(baseComment, uname);
  const payload = {
    macAddress: macNorm,
    type: "bypassed" as const,
    comment: finalComment,
    disabled: expired,
  };
  if (existing) {
    await updateIpBinding(conn, existing.id, payload);
  } else {
    await addIpBinding(conn, payload);
  }
}

router.patch("/routers/:id/users/:username", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const oldUsername = decodeURIComponent(req.params.username as string);
  const { newUsername, password, profile, bypassMacAddress, bypassComment, linkBypass, comment } = (req.body ?? {}) as {
    newUsername?: string;
    password?: string;
    profile?: string;
    bypassMacAddress?: string;
    bypassComment?: string;
    linkBypass?: boolean;
    comment?: string;
  };
  if (newUsername !== undefined && (!newUsername || !newUsername.trim())) {
    res.status(400).json({ error: "newUsername invalide" });
    return;
  }
  if (password !== undefined && (!password || !password.trim())) {
    res.status(400).json({ error: "password invalide" });
    return;
  }
  if (profile !== undefined && (!profile || !profile.trim())) {
    res.status(400).json({ error: "profile invalide" });
    return;
  }
  if (linkBypass && (!bypassMacAddress?.trim() && !bypassComment?.trim())) {
    res.status(400).json({ error: "bypassMacAddress ou bypassComment requis si linkBypass=true" });
    return;
  }
  const trimmed = newUsername?.trim();

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  const conn = { host: r.host, port: r.port, username: r.username, password: r.password };
  try {
    const updated = await updateHotspotUser(conn, oldUsername, {
      newUsername: trimmed,
      password: password?.trim(),
      profile: profile?.trim(),
      comment: comment !== undefined ? comment.trim() : undefined,
    });
    if (!updated.found) { res.status(404).json({ error: "Utilisateur introuvable sur le routeur" }); return; }
    const finalUsername = updated.username;

    if (linkBypass) {
      let mac = bypassMacAddress?.trim().toUpperCase() ?? "";
      if (!mac && bypassComment?.trim()) {
        const q = bypassComment.trim().toLowerCase();
        const bindings = await listIpBindings(conn);
        const exact = bindings.find((b) => (b.comment ?? "").trim().toLowerCase() === q && !!b.macAddress);
        const partial = bindings.find((b) => (b.comment ?? "").toLowerCase().includes(q) && !!b.macAddress);
        mac = (exact?.macAddress || partial?.macAddress || "").trim().toUpperCase();
      }
      if (!mac) {
        res.status(400).json({ error: "Impossible de résoudre la MAC depuis ce commentaire bypass" });
        return;
      }
      await upsertLinkedBypass(conn, finalUsername, mac, updated.comment, bypassComment?.trim());
    }

    userCache.delete(routerCacheScope(r.ownerAdminId, id));
    if (finalUsername !== oldUsername) {
      await db
        .update(vouchersTable)
        .set({ username: finalUsername })
        .where(and(eq(vouchersTable.routerId, id), eq(vouchersTable.username, oldUsername)));
    }
    res.json({ ok: true, oldUsername, newUsername: finalUsername });
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
  const uScope = routerCacheScope(r.ownerAdminId, id);

  const conn = { host: r.host, port: r.port, username: r.username, password: r.password };
  try {
    // Mikhmon-style fast path: execute reset on MikroTik immediately and
    // respond without waiting for local DB cleanup.
    const result = await resetHotspotUser(conn, username);

    if (!result.found) {
      console.warn(`[reset] user not found on router id=${id} username=${JSON.stringify(username)} (len=${username.length})`);
      res.status(404).json({ error: `Utilisateur "${username}" introuvable sur le routeur` });
      return;
    }

    // Surgically patch the cached snapshot so the next list call returns the
    // post-reset state instantly (no MikroTik round-trip for thousands of
    // users). The fields below mirror what `resetHotspotUser` writes back:
    // a pristine voucher with no quota override/MAC binding and normalized comment.
    // Mikhmon reset vide le commentaire — on reflète ça dans le cache
    const patched = patchCachedUser(uScope, username, {
      comment: null,
      limitUptime: null,
      limitBytesTotal: null,
      macAddress: null,
      uptime: null,
      bytesIn: null,
      bytesOut: null,
    });
    if (!patched) userCache.delete(uScope);

    // DB consistency tasks are moved to background to keep reset instant.
    void (async () => {
      try {
        await db
          .update(vouchersTable)
          .set({ usedAt: null, salePrice: null, macAddress: null, saleIp: null })
          .where(and(
            eq(vouchersTable.routerId, id),
            sql`lower(${vouchersTable.username}) = lower(${username})`,
          ));

        await db
          .delete(scriptSalesTable)
          .where(and(
            eq(scriptSalesTable.routerId, id),
            sql`lower(${scriptSalesTable.username}) = lower(${username})`,
          ));
      } catch {
        // non-blocking cleanup; next sync pass will reconcile if needed
      }
    })();

    res.json({
      ok: true,
      username,
      schedulerRemoved: result.schedulerRemoved,
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de contacter le routeur" });
  }
});

// ─── Hotspot IP-bindings (MAC bypass) ────────────────────────────────────────
//
// Kept in a short-lived cache for instant bootstrap/page-open response.
const ipBindingsCache = new Map<string, { bindings: Awaited<ReturnType<typeof listIpBindings>>; exp: number }>();
const IP_BINDINGS_TTL = 30_000;
function getIpBindingsCached(scope: string) {
  const hit = ipBindingsCache.get(scope);
  if (hit && Date.now() < hit.exp) return hit.bindings;
  return null;
}
function getIpBindingsStale(scope: string) {
  return ipBindingsCache.get(scope)?.bindings ?? null;
}
function setIpBindingsCache(scope: string, bindings: Awaited<ReturnType<typeof listIpBindings>>) {
  ipBindingsCache.set(scope, { bindings, exp: Date.now() + IP_BINDINGS_TTL });
}
function invalidateIpBindingsCache(ownerAdminId: number | null, routerId: number) {
  ipBindingsCache.delete(routerCacheScope(ownerAdminId, routerId));
}

const hotspotCookiesCache = new Map<string, { cookies: Awaited<ReturnType<typeof listHotspotCookies>>; exp: number }>();
const HOTSPOT_COOKIES_TTL = 10_000;
function getHotspotCookiesCached(scope: string) {
  const hit = hotspotCookiesCache.get(scope);
  if (hit && Date.now() < hit.exp) return hit.cookies;
  return null;
}
function setHotspotCookiesCache(scope: string, cookies: Awaited<ReturnType<typeof listHotspotCookies>>) {
  hotspotCookiesCache.set(scope, { cookies, exp: Date.now() + HOTSPOT_COOKIES_TTL });
}
function invalidateHotspotCookiesCache(ownerAdminId: number | null, routerId: number) {
  hotspotCookiesCache.delete(routerCacheScope(ownerAdminId, routerId));
}

router.get("/routers/:id/ip-bindings", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }
  const sc = routerCacheScope(r.ownerAdminId, id);
  const hit = getIpBindingsCached(sc);
  if (hit) { res.json({ bindings: hit }); return; }
  try {
    const conn: RouterConnection = { host: r.host, port: r.port, username: r.username, password: r.password };
    const bindings = await listIpBindings(conn);
    setIpBindingsCache(sc, bindings);
    res.json({ bindings });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de contacter le routeur" });
  }
});

// List Hotspot servers (instances) — used by IP-binding UI to populate the
// "Server" dropdown. Light-weight passthrough, no caching needed.
router.get("/routers/:id/hotspot-servers", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }
  try {
    const conn: RouterConnection = { host: r.host, port: r.port, username: r.username, password: r.password };
    const servers = await listHotspotServers(conn);
    res.json({ servers });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de contacter le routeur" });
  }
});

router.get("/routers/:id/dhcp-leases", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }
  const sc = routerCacheScope(r.ownerAdminId, id);
  const ck = `leases:${sc}`;
  const fresh = mGet(ck);
  if (fresh) { res.json({ leases: fresh }); return; }

  const stale = mGetStale(ck);
  if (stale) {
    res.json({ leases: stale, stale: true });
    void (async () => {
      try {
        const conn: RouterConnection = { host: r.host, port: r.port, username: r.username, password: r.password };
        const leases = await listDhcpLeases(conn);
        mSet(ck, MIK_TTL.leases, leases);
      } catch {
        // keep stale cache on refresh errors
      }
    })();
    return;
  }

  try {
    const conn: RouterConnection = { host: r.host, port: r.port, username: r.username, password: r.password };
    const leases = await listDhcpLeases(conn);
    mSet(ck, MIK_TTL.leases, leases);
    res.json({ leases });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de contacter le routeur" });
  }
});

router.get("/routers/:id/hotspot-cookies", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }
  const ckSc = routerCacheScope(r.ownerAdminId, id);
  const hit = getHotspotCookiesCached(ckSc);
  if (hit) { res.json({ cookies: hit }); return; }

  try {
    const conn: RouterConnection = { host: r.host, port: r.port, username: r.username, password: r.password };
    const cookies = await listHotspotCookies(conn);
    setHotspotCookiesCache(ckSc, cookies);
    res.json({ cookies });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de contacter le routeur" });
  }
});

router.delete("/routers/:id/hotspot-cookies/:cookieId", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const cookieId = decodeURIComponent(req.params.cookieId as string).trim();
  if (!cookieId) { res.status(400).json({ error: "cookieId requis" }); return; }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  try {
    const conn: RouterConnection = { host: r.host, port: r.port, username: r.username, password: r.password };
    await deleteHotspotCookie(conn, cookieId);
    invalidateHotspotCookiesCache(r.ownerAdminId, id);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de contacter le routeur" });
  }
});

router.delete("/routers/:id/hotspot-cookies", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const username = String(req.query.user ?? "").trim();

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  try {
    const conn: RouterConnection = { host: r.host, port: r.port, username: r.username, password: r.password };
    let removed = 0;
    if (username) {
      removed = await deleteHotspotCookiesByUser(conn, username);
    } else {
      const all = await listHotspotCookies(conn);
      for (const c of all) {
        if (!c.id) continue;
        await deleteHotspotCookie(conn, c.id);
        removed++;
      }
    }
    invalidateHotspotCookiesCache(r.ownerAdminId, id);
    res.json({ ok: true, removed });
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
    await addIpBinding(conn, parsed);
    await triggerQueueSyncForCreatedBinding(id, conn, parsed);
    invalidateIpBindingsCache(r.ownerAdminId, id);
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
    await updateIpBinding(conn, bindingId, parsed);
    const parsedKeys = Object.keys(parsed);
    if (parsedKeys.length === 1 && parsed.disabled !== undefined) {
      // Fast toggle path: update queue disabled flag directly by marker
      // without fetching/rebuilding the full binding state.
      await setIpBindingQueueDisabledByBindingId(conn, bindingId, parsed.disabled);
    } else {
      await triggerQueueSyncForBindingId(id, conn, bindingId);
    }
    invalidateIpBindingsCache(r.ownerAdminId, id);
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
    await deleteIpBinding(conn, bindingId);
    await triggerQueueDeleteForBinding(id, conn, { id: bindingId });
    invalidateIpBindingsCache(r.ownerAdminId, id);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Erreur MikroTik" });
  }
});

// ─── Sales cache ─────────────────────────────────────────────────────────────
interface SalesCacheEntry { data: SalesReport; updatedAt: number; }
const salesCache = new Map<string, SalesCacheEntry>();
const salesRefreshing = new Set<number>();
const SALES_TTL = 5 * 60 * 1000; // 5 minutes

const voucherRowMoney = sql`coalesce(nullif(regexp_replace(coalesce(${vouchersTable.salePrice}, ${vouchersTable.price}), '[^0-9.]', '', 'g'), '')::numeric, 0)`;

/** Pas de double comptage : bon ignoré s'il existe déjà une vente script même user + même jour UTC. */
function voucherNotCoveredByScriptSameUtcDay() {
  return notExists(
    db.select({ id: scriptSalesTable.id })
      .from(scriptSalesTable)
      .where(and(
        eq(scriptSalesTable.routerId, vouchersTable.routerId),
        sql`lower(${scriptSalesTable.username}) = lower(${vouchersTable.username})`,
        sql`((${scriptSalesTable.saleDate} AT TIME ZONE 'UTC')::date) = ((${vouchersTable.usedAt} AT TIME ZONE 'UTC')::date)`,
      )),
  );
}

/**
 * Agrégats jour / mois pour le tableau de bord — **même périmètre** que
 * `GET /routers/:id/sales-report` : `mikrotik_script_sales` + bons vendus
 * **hors doublon** (pas de ligne script même login + même jour UTC), dates UTC.
 */
async function readSalesQuickFromDb(routerId: number): Promise<{
  dailyCount: number;
  dailyAmount: number;
  monthlyCount: number;
  monthlyAmount: number;
} | null> {
  const now = new Date();
  const yUtc = now.getUTCFullYear();
  const mUtc = now.getUTCMonth() + 1;
  const dUtc = now.getUTCDate();
  try {
    const [scriptRow, voucherRow] = await Promise.all([
      db
        .select({
          dailyCount: sql<number>`cast(count(*) filter (where
            EXTRACT(YEAR  FROM ${scriptSalesTable.saleDate} AT TIME ZONE 'UTC') = ${yUtc}
            AND EXTRACT(MONTH FROM ${scriptSalesTable.saleDate} AT TIME ZONE 'UTC') = ${mUtc}
            AND EXTRACT(DAY   FROM ${scriptSalesTable.saleDate} AT TIME ZONE 'UTC') = ${dUtc}
          ) as int)`,
          dailyAmount: sql<number>`coalesce(sum(cast(${scriptSalesTable.price} as double precision)) filter (where
            EXTRACT(YEAR  FROM ${scriptSalesTable.saleDate} AT TIME ZONE 'UTC') = ${yUtc}
            AND EXTRACT(MONTH FROM ${scriptSalesTable.saleDate} AT TIME ZONE 'UTC') = ${mUtc}
            AND EXTRACT(DAY   FROM ${scriptSalesTable.saleDate} AT TIME ZONE 'UTC') = ${dUtc}
          ), 0)`,
          monthlyCount: sql<number>`cast(count(*) filter (where
            EXTRACT(YEAR  FROM ${scriptSalesTable.saleDate} AT TIME ZONE 'UTC') = ${yUtc}
            AND EXTRACT(MONTH FROM ${scriptSalesTable.saleDate} AT TIME ZONE 'UTC') = ${mUtc}
          ) as int)`,
          monthlyAmount: sql<number>`coalesce(sum(cast(${scriptSalesTable.price} as double precision)) filter (where
            EXTRACT(YEAR  FROM ${scriptSalesTable.saleDate} AT TIME ZONE 'UTC') = ${yUtc}
            AND EXTRACT(MONTH FROM ${scriptSalesTable.saleDate} AT TIME ZONE 'UTC') = ${mUtc}
          ), 0)`,
        })
        .from(scriptSalesTable)
        .where(eq(scriptSalesTable.routerId, routerId)),
      db
        .select({
          dailyCount: sql<number>`cast(count(*) filter (where
            EXTRACT(YEAR FROM ${vouchersTable.usedAt} AT TIME ZONE 'UTC') = ${yUtc}
            AND EXTRACT(MONTH FROM ${vouchersTable.usedAt} AT TIME ZONE 'UTC') = ${mUtc}
            AND EXTRACT(DAY FROM ${vouchersTable.usedAt} AT TIME ZONE 'UTC') = ${dUtc}
          ) as int)`,
          dailyAmount: sql<number>`coalesce(sum(${voucherRowMoney}) filter (where
            EXTRACT(YEAR FROM ${vouchersTable.usedAt} AT TIME ZONE 'UTC') = ${yUtc}
            AND EXTRACT(MONTH FROM ${vouchersTable.usedAt} AT TIME ZONE 'UTC') = ${mUtc}
            AND EXTRACT(DAY FROM ${vouchersTable.usedAt} AT TIME ZONE 'UTC') = ${dUtc}
          ), 0)`,
          monthlyCount: sql<number>`cast(count(*) filter (where
            EXTRACT(YEAR FROM ${vouchersTable.usedAt} AT TIME ZONE 'UTC') = ${yUtc}
            AND EXTRACT(MONTH FROM ${vouchersTable.usedAt} AT TIME ZONE 'UTC') = ${mUtc}
          ) as int)`,
          monthlyAmount: sql<number>`coalesce(sum(${voucherRowMoney}) filter (where
            EXTRACT(YEAR FROM ${vouchersTable.usedAt} AT TIME ZONE 'UTC') = ${yUtc}
            AND EXTRACT(MONTH FROM ${vouchersTable.usedAt} AT TIME ZONE 'UTC') = ${mUtc}
          ), 0)`,
        })
        .from(vouchersTable)
        .where(and(
          eq(vouchersTable.routerId, routerId),
          isNotNull(vouchersTable.usedAt),
          voucherNotCoveredByScriptSameUtcDay(),
        )),
    ]);
    const s = scriptRow[0];
    const v = voucherRow[0];
    return {
      dailyCount:    Number(s?.dailyCount    ?? 0) + Number(v?.dailyCount    ?? 0),
      dailyAmount:   Number(s?.dailyAmount   ?? 0) + Number(v?.dailyAmount   ?? 0),
      monthlyCount:  Number(s?.monthlyCount  ?? 0) + Number(v?.monthlyCount  ?? 0),
      monthlyAmount: Number(s?.monthlyAmount ?? 0) + Number(v?.monthlyAmount ?? 0),
    };
  } catch {
    return null;
  }
}

async function readVendorRankingQuickFromDb(routerId: number) {
  return aggregateVendorPeriodSales(routerId);
}

async function triggerSalesRefresh(ownerAdminId: number | null, id: number, host: string, port: number, username: string, password: string) {
  if (salesRefreshing.has(id)) return;
  salesRefreshing.add(id);
  try {
    const conn = { host, port, username, password };
    // Use 90s timeout — background work, not tied to a short HTTP client deadline
    const data = await fetchSalesFromScripts(conn, 90_000);
    const scope = routerCacheScope(ownerAdminId, id);
    salesCache.set(scope, { data, updatedAt: Date.now() });
  } catch { /* keep stale cache on error */ } finally {
    salesRefreshing.delete(id);
  }
}

/** Full RAM purge for one routers row (credentials change, delete, tenant isolation). */
export function purgeRouterRowVolatileCaches(ownerAdminId: number | null, routerId: number): void {
  const scope = routerCacheScope(ownerAdminId, routerId);
  invalidateProfileListCache(ownerAdminId, routerId);
  userCache.delete(scope);
  _usersCountCache.delete(scope);
  ipBindingsCache.delete(scope);
  hotspotCookiesCache.delete(scope);
  salesCache.delete(scope);
  purgeMikKeysForScope(scope);
  clearRouterScriptCache(routerId);
}

// ─── Usage sync (real-time sold voucher detection) ───────────────────────────
interface UsageSyncEntry { updatedAt: number; updated: number; total: number; }
const usageSyncCache  = new Map<number, UsageSyncEntry>();
const usageSyncActive = new Set<number>(); // routers currently syncing
const usageSyncTimer  = new Map<number, ReturnType<typeof setTimeout>>();
const USAGE_SYNC_INTERVAL   = 15_000;      // 15 s  — matches script-cache incremental gap
const ROUTER_IDLE_TIMEOUT   = 5 * 60_000;  // 5 min — stop syncing if no requests

/** Tracks the last time each router received a user request */
const lastRouterActivityAt = new Map<number, number>();

/** Call from any route that actively uses a router to keep its sync loop alive */
function markRouterActive(routerId: number): void {
  lastRouterActivityAt.set(routerId, Date.now());
}

/** Background auto-sync — self-reschedules every USAGE_SYNC_INTERVAL.
 *  Stops automatically when the router has been idle for ROUTER_IDLE_TIMEOUT. */
async function scheduleUsageSync(routerId: number, conn: RouterConnection) {
  if (usageSyncActive.has(routerId)) return;

  // Stop the loop if nobody has touched this router recently.
  const lastActivity = lastRouterActivityAt.get(routerId) ?? 0;
  if (Date.now() - lastActivity > ROUTER_IDLE_TIMEOUT) {
    usageSyncTimer.delete(routerId);
    logger.info({ routerId }, "usage sync: routeur inactif — boucle arrêtée");
    return;
  }

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

  const salesScope = routerCacheScope(r.ownerAdminId, id);
  const cached = salesCache.get(salesScope);
  const now = Date.now();

  // Trigger background refresh if cache is absent, stale (> TTL), or aging (> 2min)
  const needsRefresh = !cached || (now - cached.updatedAt) > SALES_TTL;
  const agingRefresh = cached && (now - cached.updatedAt) > 2 * 60 * 1000;
  if (needsRefresh || agingRefresh) {
    triggerSalesRefresh(r.ownerAdminId, id, r.host, r.port, r.username, r.password);
  }
  // Mark active + ensure sync is running for this router
  markRouterActive(id);
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

async function buildDashboardPrioritySnapshot(id: number) {
  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) throw new Error("ROUTER_NOT_FOUND");
  const sc = routerCacheScope(r.ownerAdminId, id);

  const conn: RouterConnection = { host: r.host, port: r.port, username: r.username, password: r.password };
  markRouterActive(id);
  ensureUsageSyncScheduled(id, conn);
  // Ventes des cartes : cache scripts + bons « seuls » (hors doublon jour UTC / login), comme GET …/sales-report.
  // Ne pas lancer fetchSalesFromScripts ici : le SSE appelle ce snapshot ~1,5 s et écraserait les totaux
  // avec ce qu’il reste sur le routeur (souvent quasi vide si auto-suppression des scripts).

  const now = Date.now();

  // ── Cold-start parallèle : sessions + info routeur + comptage tickets ────────
  // Stratégie "instant-on" pour les 3 KPIs du dashboard :
  //   • Cold server (après restart/déploiement) : les 3 fetches MikroTik manquants
  //     sont lancés EN PARALLÈLE (Promise.all) → premier appel retourne les vraies
  //     données en max(latences) au lieu de leur somme.
  //   • Cache chaud : données stale servies immédiatement, refresh en arrière-plan.
  //   • Cache localStorage client (initialData) : affiche les dernières valeurs
  //     connues dès le montage du composant, avant même la réponse réseau.

  const sessionsKey = `sessions:${sc}`;
  const sessionsFresh = mGet(sessionsKey) as unknown[] | null;
  const sessionsStale = mGetStale(sessionsKey) as unknown[] | null;
  const fastEntryBefore = _sessionsFastCount.get(sc);
  const fastCountBefore = fastEntryBefore && (now - fastEntryBefore.cachedAt) < 8_000 ? fastEntryBefore.count : null;

  const infoKey = `info:${sc}`;
  const infoFresh = mGet(infoKey);
  const infoStale = mGetStale(infoKey);

  const usersCachedBefore = _usersCountCache.get(sc) ?? null;
  const userHit   = userCache.get(sc);
  const userFresh = !!userHit && now < userHit.expiresAt;
  const COUNT_FRESH_MS = 20_000;

  // Détecter les manques (cold start pour chaque KPI)
  const needSessionsCold = !sessionsFresh && !sessionsStale && fastCountBefore === null && !_sessionsFastRefreshing.has(id);
  const needInfoCold     = !infoFresh && !infoStale && !_infoRefreshing.has(id);
  const needUsersCold    = !usersCachedBefore && !_usersRefreshing.has(id);

  if (needSessionsCold || needInfoCold || needUsersCold) {
    // Cold start — lancer chaque fetch en arrière-plan (non-bloquant).
    // La réponse est renvoyée immédiatement avec les valeurs vides/null ;
    // le frontend affiche des skeletons puis se rafraîchit dès que les caches sont chauds.
    if (needSessionsCold) {
      _sessionsFastRefreshing.add(id);
      setImmediate(async () => {
        try { _sessionsFastCount.set(sc, { count: await countSessionsFast(conn), cachedAt: Date.now() }); }
        catch { /* keep 0 */ }
        finally { _sessionsFastRefreshing.delete(id); }
      });
    }
    if (needInfoCold) {
      _infoRefreshing.add(id);
      setImmediate(async () => {
        try { mSet(infoKey, MIK_TTL.info, await getRouterInfo(conn)); }
        catch { /* keep null */ }
        finally { _infoRefreshing.delete(id); }
      });
    }
    if (needUsersCold) {
      _usersRefreshing.add(id);
      setImmediate(async () => {
        try {
          const list = await listHotspotUsersFast(conn);
          _usersCountCache.set(sc, await computeUsersCount(id, conn, list));
        } catch { /* keep zeros */ }
        finally { _usersRefreshing.delete(id); }
      });
    }
  } else {
    // Cache chaud — refresh stale en arrière-plan (non-bloquant)
    if (!sessionsFresh && !_sessionsRefreshing.has(id)) {
      _sessionsRefreshing.add(id);
      setImmediate(async () => {
        try { mSet(sessionsKey, MIK_TTL.sessions, await listSessions(conn)); }
        catch { /* keep stale */ }
        finally { _sessionsRefreshing.delete(id); }
      });
    }
    if (!infoFresh && !_infoRefreshing.has(id)) {
      _infoRefreshing.add(id);
      setImmediate(async () => {
        try { mSet(infoKey, MIK_TTL.info, await getRouterInfo(conn)); }
        catch { /* keep stale */ }
        finally { _infoRefreshing.delete(id); }
      });
    }
    const usersCachedNow = _usersCountCache.get(sc);
    if (usersCachedNow && (now - usersCachedNow.cachedAt) > COUNT_FRESH_MS) {
      scheduleUserCacheAndCountRefresh(id, r.ownerAdminId, conn, !userFresh);
    }
  }

  // Full sessions list refresh (pour la page Sessions) — toujours en arrière-plan
  if (!sessionsFresh && !_sessionsRefreshing.has(id)) {
    _sessionsRefreshing.add(id);
    setImmediate(async () => {
      try { mSet(sessionsKey, MIK_TTL.sessions, await listSessions(conn)); }
      catch { /* keep stale */ }
      finally { _sessionsRefreshing.delete(id); }
    });
  }

  // Lire les caches après les fetches éventuels
  const sessionsFreshAfter = mGet(sessionsKey) as unknown[] | null;
  const sessionsStaleAfter = mGetStale(sessionsKey) as unknown[] | null;
  const fastEntryAfter     = _sessionsFastCount.get(sc);
  const fastCountAfter     = fastEntryAfter && (now - fastEntryAfter.cachedAt) < 8_000 ? fastEntryAfter.count : null;
  const sessionsCount = sessionsFreshAfter?.length ?? sessionsStaleAfter?.length ?? fastCountAfter ?? 0;

  const infoFreshAfter = mGet(infoKey);
  const infoStaleAfter = mGetStale(infoKey);
  const info = (infoFreshAfter ?? infoStaleAfter ?? null) as Awaited<ReturnType<typeof getRouterInfo>> | null;

  const usersCached = _usersCountCache.get(sc) ?? null;
  const users = usersCached
    ? { total: usersCached.total, available: usersCached.available, used: usersCached.used, disabled: usersCached.disabled, cachedAt: usersCached.cachedAt }
    : { total: 0, available: 0, used: 0, disabled: 0, cachedAt: null as number | null };

  // Jour / mois : agrégation DB (alignée rapport local). Autres périodes : cache RAM live si dispo.
  const salesCached = salesCache.get(sc);
  const [dbQuickSales, vendorRanking] = await Promise.all([
    readSalesQuickFromDb(id),
    readVendorRankingQuickFromDb(id),
  ]);
  const mm = String(new Date().getMonth() + 1).padStart(2, "0");
  const y = new Date().getFullYear();
  const d = String(new Date().getDate()).padStart(2, "0");
  const dm = dbQuickSales
    ?? (salesCached
      ? {
        dailyCount: salesCached.data.dailyCount,
        dailyAmount: salesCached.data.dailyAmount,
        monthlyCount: salesCached.data.monthlyCount,
        monthlyAmount: salesCached.data.monthlyAmount,
      }
      : { dailyCount: 0, dailyAmount: 0, monthlyCount: 0, monthlyAmount: 0 });
  const sales: SalesReport & { _cachedAt: number | null } = {
    dailyCount: dm.dailyCount,
    dailyAmount: dm.dailyAmount,
    yesterdayCount: salesCached?.data.yesterdayCount ?? 0,
    yesterdayAmount: salesCached?.data.yesterdayAmount ?? 0,
    weekCount: salesCached?.data.weekCount ?? 0,
    weekAmount: salesCached?.data.weekAmount ?? 0,
    lastWeekCount: salesCached?.data.lastWeekCount ?? 0,
    lastWeekAmount: salesCached?.data.lastWeekAmount ?? 0,
    monthlyCount: dm.monthlyCount,
    monthlyAmount: dm.monthlyAmount,
    lastMonthCount: salesCached?.data.lastMonthCount ?? 0,
    lastMonthAmount: salesCached?.data.lastMonthAmount ?? 0,
    totalCount: salesCached?.data.totalCount ?? 0,
    totalAmount: salesCached?.data.totalAmount ?? 0,
    dateLabel: `${y}-${mm}-${d}`,
    monthLabel: `${mm}${y}`,
    _cachedAt: dbQuickSales != null ? Date.now() : (salesCached ? salesCached.updatedAt : null),
  };

  return {
    serverTs: now,
    sessionsCount,
    users,
    sales,
    vendorRanking,
    info,
    availability: {
      // sessionsKnown : vrai si le cache plein OU le fast count (cold-start parallèle) ont des données
      sessionsKnown: !!(sessionsFreshAfter || sessionsStaleAfter) || fastCountAfter !== null,
      usersKnown: !!usersCached,
      salesKnown: dbQuickSales != null || !!salesCached,
      vendorRankingKnown: vendorRanking != null,
      infoKnown: !!(infoFreshAfter || infoStaleAfter),
    },
  };
}

let dashboardPriorityWarmTimer: ReturnType<typeof setInterval> | null = null;
const dashboardPriorityWarmStatus = new Map<number, { updatedAt: number; ok: boolean; error?: string }>();

/**
 * Pre-warm dashboard-priority caches in background so first dashboard paint is instant
 * even right after API startup (Mikhmon-style warm cache).
 */
export function startDashboardPriorityWarmer() {
  if (dashboardPriorityWarmTimer) return;
  const intervalMs = Number(process.env.DASHBOARD_PRIORITY_WARM_INTERVAL_MS || 20_000);

  const run = async () => {
    try {
      const routers = await db.select().from(routersTable);
      for (const r of routers) {
        try {
          await buildDashboardPrioritySnapshot(r.id);
          dashboardPriorityWarmStatus.set(r.id, { updatedAt: Date.now(), ok: true });
        } catch {
          dashboardPriorityWarmStatus.set(r.id, { updatedAt: Date.now(), ok: false, error: "warm_failed" });
          // Keep warming loop resilient per-router.
        }
      }
    } catch {
      // Keep warmer alive on transient DB errors.
    }
  };

  void run();
  dashboardPriorityWarmTimer = setInterval(() => { void run(); }, intervalMs);
}

/**
 * GET /routers/dashboard-priority/warm-status
 * Returns pre-warm status for each router.
 */
router.get("/routers/dashboard-priority/warm-status", async (_req, res): Promise<void> => {
  try {
    const routers = await db
      .select({ id: routersTable.id, name: routersTable.name })
      .from(routersTable);
    const now = Date.now();
    res.json({
      warmerRunning: !!dashboardPriorityWarmTimer,
      routers: routers.map((r) => {
        const st = dashboardPriorityWarmStatus.get(r.id);
        return {
          routerId: r.id,
          routerName: r.name,
          lastWarmAt: st?.updatedAt ?? null,
          ageMs: st?.updatedAt ? now - st.updatedAt : null,
          ok: st?.ok ?? null,
          error: st?.error ?? null,
        };
      }),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Erreur warm-status" });
  }
});

/**
 * GET /routers/:id/dashboard-priority
 * Atomic snapshot for critical dashboard KPIs:
 * - active sessions
 * - tickets available/used/disabled
 * - daily/monthly sales
 * - router hardware/info bar
 */
router.get("/routers/:id/dashboard-priority", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  try {
    const snapshot = await buildDashboardPrioritySnapshot(id);
    res.json(snapshot);
  } catch (err) {
    if (err instanceof Error && err.message === "ROUTER_NOT_FOUND") {
      res.status(404).json({ error: "Routeur introuvable" });
      return;
    }
    res.status(502).json({ error: err instanceof Error ? err.message : "Erreur routeur" });
  }
});

/**
 * GET /routers/:id/unattributed-period-sales?period=today|month
 * Détail des ventes sans suffixe vendeur reconnu (scripts + bons).
 */
router.get("/routers/:id/unattributed-period-sales", async (req, res): Promise<void> => {
  const adminScope = getAdminScopeFromHeader(req);
  if (!adminScope) { res.status(401).json({ error: "Non authentifié" }); return; }
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  if (!adminScope.isSuperAdmin || adminScope.isImpersonating) {
    const [r] = await db.select({ owner: routersTable.ownerAdminId })
      .from(routersTable).where(eq(routersTable.id, id));
    if (!r || r.owner !== adminScope.adminId) { res.status(403).json({ error: "Accès refusé" }); return; }
  }

  const { period } = req.query as { period?: string };
  if (period !== "today" && period !== "month") {
    res.status(400).json({ error: "Période invalide (today ou month)" });
    return;
  }

  const result = await fetchUnattributedPeriodSales(id, period);
  if (!result) { res.status(500).json({ error: "Impossible de charger les ventes non attribuées" }); return; }

  const [routerRow] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  let priceMap = new Map<string, string>();
  if (routerRow) {
    const conn: RouterConnection = {
      host: routerRow.host,
      port: routerRow.port,
      username: routerRow.username,
      password: routerRow.password,
    };
    priceMap = getCachedProfilePricesSync(id, conn);
  }

  const enrichedVouchers = result.vouchers.map((v) => ({
    ...v,
    price: v.salePrice || v.price || priceMap.get(v.profileName) || v.price,
  }));

  res.json({ ...result, vouchers: enrichedVouchers });
});

/**
 * GET /routers/:id/bootstrap
 * Single-call startup payload to make first page loads feel instant (Mikhmon-style):
 * - returns what is already known from in-memory caches
 * - triggers missing parts to warm in background without blocking response
 */
router.get("/routers/:id/bootstrap", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }
  const sc = routerCacheScope(r.ownerAdminId, id);

  try {
    const conn: RouterConnection = { host: r.host, port: r.port, username: r.username, password: r.password };

    // Always include the priority snapshot (it already uses stale-while-revalidate internally).
    const priority = await buildDashboardPrioritySnapshot(id);

    const profilesFresh = getFreshProfileCache(sc);
    const profilesStale = profileListCache.get(sc)?.profiles ?? null;
    const profiles = profilesFresh ?? profilesStale ?? [];
    const profilesKnown = !!(profilesFresh || profilesStale);
    if (!profilesKnown) {
      void fetchProfilesWithCache(r.ownerAdminId, id, conn).catch(() => undefined);
    }

    const poolsKey = `pools:${sc}`;
    const poolsFresh = mGet(poolsKey) as string[] | null;
    const poolsStale = mGetStale(poolsKey) as string[] | null;
    const pools = poolsFresh ?? poolsStale ?? [];
    const poolsKnown = !!(poolsFresh || poolsStale);
    if (!poolsKnown) {
      setImmediate(async () => {
        try {
          const next = await listAddressPools(conn);
          mSet(poolsKey, MIK_TTL.pools, next);
        } catch { /* keep empty snapshot */ }
      });
    }

    const usersCount = _usersCountCache.get(sc) ?? null;
    if (!usersCount) {
      scheduleUserCacheAndCountRefresh(id, r.ownerAdminId, conn, true);
    }

    const sessionsKey = `sessions:${sc}`;
    const sessionsFresh = mGet(sessionsKey) as Awaited<ReturnType<typeof listSessions>> | null;
    const sessionsStale = mGetStale(sessionsKey) as Awaited<ReturnType<typeof listSessions>> | null;
    const sessions = sessionsFresh ?? sessionsStale ?? [];
    const sessionsKnown = !!(sessionsFresh || sessionsStale);
    if (!sessionsKnown && !_sessionsRefreshing.has(id)) {
      _sessionsRefreshing.add(id);
      setImmediate(async () => {
        try {
          const list = await listSessions(conn);
          mSet(sessionsKey, MIK_TTL.sessions, list);
        } catch { /* keep empty snapshot */ }
        finally { _sessionsRefreshing.delete(id); }
      });
    }

    const ipBindingsFresh = getIpBindingsCached(sc);
    const ipBindingsStale = getIpBindingsStale(sc);
    const ipBindings = ipBindingsFresh ?? ipBindingsStale ?? [];
    const ipBindingsKnown = !!(ipBindingsFresh || ipBindingsStale);
    if (!ipBindingsKnown) {
      setImmediate(async () => {
        try {
          const list = await listIpBindings(conn);
          setIpBindingsCache(sc, list);
        } catch { /* keep empty snapshot */ }
      });
    }

    const interfacesKey = `interfaces:${sc}`;
    const interfacesFresh = mGet(interfacesKey) as Awaited<ReturnType<typeof listInterfaces>> | null;
    const interfacesStale = mGetStale(interfacesKey) as Awaited<ReturnType<typeof listInterfaces>> | null;
    const interfaces = interfacesFresh ?? interfacesStale ?? [];
    const interfacesKnown = !!(interfacesFresh || interfacesStale);
    if (!interfacesKnown) {
      setImmediate(async () => {
        try {
          const list = await listInterfaces(conn);
          mSet(interfacesKey, MIK_TTL.interfaces, list);
        } catch { /* keep empty snapshot */ }
      });
    }

    const logsKey = `logs:${sc}:hotspot-user:80`;
    const logsFresh = mGet(logsKey) as Awaited<ReturnType<typeof listLogs>> | null;
    const logsStale = mGetStale(logsKey) as Awaited<ReturnType<typeof listLogs>> | null;
    const logs = logsFresh ?? logsStale ?? [];
    const logsKnown = !!(logsFresh || logsStale);
    if (!logsKnown) {
      setImmediate(async () => {
        try {
          const list = await listLogs(conn, 80, "hotspot", true);
          mSet(logsKey, MIK_TTL.logs, list);
        } catch { /* keep empty snapshot */ }
      });
    }

    res.json({
      serverTs: Date.now(),
      priority,
      profiles,
      pools,
      usersCount,
      sessions,
      ipBindings,
      interfaces,
      logs,
      availability: {
        priorityKnown: true,
        profilesKnown,
        poolsKnown,
        usersCountKnown: !!usersCount,
        sessionsKnown,
        ipBindingsKnown,
        interfacesKnown,
        logsKnown,
      },
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Erreur bootstrap" });
  }
});

/**
 * GET /routers/:id/dashboard-priority/stream
 * Server-Sent Events push stream for dashboard-priority snapshots.
 *
 * Anti-spam: all SSE clients for the same routerId share ONE background poller
 * (via mikrotik-poller.ts). MikroTik is queried at most once per
 * MIK_POLLER_INTERVAL_MS (default 5 s) regardless of how many clients are
 * connected — instead of once per client per 1.5 s as before.
 */
router.get("/routers/:id/dashboard-priority/stream", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  let closed = false;

  const unsubscribe = subscribeRouterPoller(
    id,
    () => buildDashboardPrioritySnapshot(id),
    (snapshot) => {
      if (closed) return;
      res.write(`event: priority\n`);
      res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
    },
    (msg) => {
      if (closed) return;
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
    },
  );

  const heartbeat = setInterval(() => {
    if (!closed) res.write(": keep-alive\n\n");
  }, 20_000);

  req.on("close", () => {
    closed = true;
    unsubscribe();
    clearInterval(heartbeat);
    res.end();
  });
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
  markRouterActive(id);
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
 * Ventes routeur : cache scripts MikHMon (`mikrotik_script_sales`) + bons vendus
 * **sans doublon** (même login + même jour UTC qu’une ligne script → le bon est exclu).
 * Sans filtre année : uniquement les scripts (volume potentiel des bons trop élevé).
 * Query params:
 *   ?year=2026&month=3       → monthly (+ bons hors doublon si année renseignée)
 *   ?year=2026&month=3&day=5 → daily
 *   (none)                   → all history (scripts seulement)
 */
router.get("/routers/:id/sales-report", async (req, res): Promise<void> => {
  const adminScope = getAdminScopeFromHeader(req);
  if (!adminScope) { res.status(401).json({ error: "Non authentifié" }); return; }
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  if (!adminScope.isSuperAdmin || adminScope.isImpersonating) {
    const [r] = await db.select({ owner: routersTable.ownerAdminId })
      .from(routersTable).where(eq(routersTable.id, id));
    if (!r || r.owner !== adminScope.adminId) { res.status(403).json({ error: "Accès refusé" }); return; }
  }

  const yearRaw  = req.query.year  ? parseInt(req.query.year  as string, 10) : null;
  const monthRaw = req.query.month ? parseInt(req.query.month as string, 10) : null;
  const dayRaw   = req.query.day   ? parseInt(req.query.day   as string, 10) : null;
  const withPresence = String(req.query.presence ?? "") === "1" || String(req.query.presence ?? "") === "true";

  // Sync the script cache before reading so the report includes the latest
  // MikroTik sales entries. syncScriptCache() is throttled to 1 min so this
  // is effectively a no-op when called repeatedly. We cap the wait at 12 s to
  // keep the response snappy even on slow routers.
  try {
    const [routerRow] = await db
      .select({ host: routersTable.host, port: routersTable.port, username: routersTable.username, password: routersTable.password })
      .from(routersTable)
      .where(eq(routersTable.id, id))
      .limit(1);
    if (routerRow) {
      const conn: RouterConnection = { host: routerRow.host, port: routerRow.port, username: routerRow.username, password: routerRow.password };
      markRouterActive(id);
      ensureUsageSyncScheduled(id, conn);
      await Promise.race([
        syncScriptCache(id, conn),
        new Promise<void>((resolve) => setTimeout(resolve, 12_000)),
      ]);
    }
  } catch {
    // Non-blocking: if the router is unreachable we still serve data from DB.
  }

  try {
    const conditions: ReturnType<typeof eq>[] = [eq(scriptSalesTable.routerId, id) as any];
    if (yearRaw !== null && !Number.isNaN(yearRaw)) {
      conditions.push(sql`EXTRACT(YEAR  FROM ${scriptSalesTable.saleDate} AT TIME ZONE 'UTC') = ${yearRaw}` as any);
    }
    if (monthRaw !== null && !Number.isNaN(monthRaw)) {
      conditions.push(sql`EXTRACT(MONTH FROM ${scriptSalesTable.saleDate} AT TIME ZONE 'UTC') = ${monthRaw}` as any);
    }
    if (dayRaw !== null && !Number.isNaN(dayRaw)) {
      conditions.push(sql`EXTRACT(DAY   FROM ${scriptSalesTable.saleDate} AT TIME ZONE 'UTC') = ${dayRaw}` as any);
    }

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
        rawName:  scriptSalesTable.rawName,
      })
      .from(scriptSalesTable)
      .where(and(...conditions))
      .orderBy(sql`${scriptSalesTable.saleDate} DESC`);

    let liveRawNames = new Set<string>();
    if (withPresence && yearRaw !== null && !Number.isNaN(yearRaw) && monthRaw !== null && !Number.isNaN(monthRaw) && monthRaw >= 1 && monthRaw <= 12) {
      const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
      if (r) {
        const conn: RouterConnection = { host: r.host, port: r.port, username: r.username, password: r.password };
        try {
          await withRouterLock(id, async () => {
            const live = await fetchScriptSales(conn, { type: "month", year: yearRaw, month: monthRaw }, 60_000);
            liveRawNames = new Set(live.map((e) => [
              e.date, e.time, e.username, e.price, e.ip, e.mac, e.validity, e.label, e.batch,
            ].join("-|-")));
          });
        } catch {
          // Non-blocking marker check: keep report available from local DB.
          liveRawNames = new Set<string>();
        }
      }
    }

    const scriptEntries = rows.map(({ price, rawName, ...rest }) => ({
      ...rest,
      rawName: rawName ?? null,
      price: parseFloat(price) || 0,
      source: liveRawNames.size > 0 && rawName && liveRawNames.has(rawName) ? ("mikrotik+local" as const) : ("local-db" as const),
      origin: "script" as const,
    }));

    const voucherRows =
      yearRaw !== null && !Number.isNaN(yearRaw)
        ? await db
            .select({
              id: vouchersTable.id,
              date: sql<string>`to_char(${vouchersTable.usedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
              time: sql<string>`to_char(${vouchersTable.usedAt} AT TIME ZONE 'UTC', 'HH24:MI:SS')`,
              username: vouchersTable.username,
              saleIp: vouchersTable.saleIp,
              macAddress: vouchersTable.macAddress,
              validity: vouchersTable.validity,
              profileName: vouchersTable.profileName,
              comment: vouchersTable.comment,
              amt: sql<number>`(${voucherRowMoney})::double precision`,
            })
            .from(vouchersTable)
            .where(and(
              eq(vouchersTable.routerId, id),
              isNotNull(vouchersTable.usedAt),
              voucherNotCoveredByScriptSameUtcDay(),
              sql`EXTRACT(YEAR FROM ${vouchersTable.usedAt} AT TIME ZONE 'UTC') = ${yearRaw}`,
              ...(monthRaw !== null && !Number.isNaN(monthRaw)
                ? [sql`EXTRACT(MONTH FROM ${vouchersTable.usedAt} AT TIME ZONE 'UTC') = ${monthRaw}`]
                : []),
              ...(dayRaw !== null && !Number.isNaN(dayRaw)
                ? [sql`EXTRACT(DAY FROM ${vouchersTable.usedAt} AT TIME ZONE 'UTC') = ${dayRaw}`]
                : []),
            ))
            .orderBy(desc(vouchersTable.usedAt))
        : [];

    const voucherEntries = voucherRows.map((v) => ({
      date: v.date,
      time: v.time,
      username: v.username,
      price: Number(v.amt) || 0,
      ip: v.saleIp ?? "",
      mac: v.macAddress ?? "",
      validity: v.validity ?? "",
      label: v.profileName ?? "",
      batch: v.comment ?? null,
      rawName: `voucher:${v.id}`,
      source: "local-db" as const,
      origin: "voucher" as const,
    }));

    const merged = [...scriptEntries, ...voucherEntries].sort((a, b) => {
      const ta = Date.parse(`${a.date}T${a.time || "00:00:00"}Z`);
      const tb = Date.parse(`${b.date}T${b.time || "00:00:00"}Z`);
      if (tb !== ta) return tb - ta;
      return a.username.localeCompare(b.username, "fr");
    });

    res.json(merged);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Erreur base de données" });
  }
});

/**
 * DELETE /routers/:id/sales-report/scripts?year=YYYY&month=M
 * Removes MikHMon sales scripts for the selected month directly from MikroTik
 * while keeping local script_sales cache/history intact.
 */
router.delete("/routers/:id/sales-report/scripts", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const yearRaw = req.query.year ? parseInt(req.query.year as string, 10) : NaN;
  const monthRaw = req.query.month ? parseInt(req.query.month as string, 10) : NaN;
  if (!Number.isFinite(yearRaw) || !Number.isFinite(monthRaw) || monthRaw < 1 || monthRaw > 12) {
    res.status(400).json({ error: "Paramètres year/month invalides" });
    return;
  }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  const conn: RouterConnection = { host: r.host, port: r.port, username: r.username, password: r.password };
  try {
    const result = await withRouterLock(id, async () => {
      const monthPadded = String(monthRaw).padStart(2, "0");
      const nextYear = monthRaw === 12 ? yearRaw + 1 : yearRaw;
      const nextMonth = monthRaw === 12 ? 1 : monthRaw + 1;
      const nextMonthPadded = String(nextMonth).padStart(2, "0");
      // Drizzle timestamp bindings expect Date, not ISO strings (avoids toISOString crash).
      const rangeStart = new Date(`${yearRaw}-${monthPadded}-01T00:00:00.000Z`);
      const rangeEndExclusive = new Date(`${nextYear}-${nextMonthPadded}-01T00:00:00.000Z`);

      const monthRows = await db
        .select({ rawName: scriptSalesTable.rawName })
        .from(scriptSalesTable)
        .where(and(
          eq(scriptSalesTable.routerId, id),
          gte(scriptSalesTable.saleDate, rangeStart),
          lt(scriptSalesTable.saleDate, rangeEndExclusive),
        ));
      const preferredRawNames = monthRows.map((r) => String(r.rawName ?? "").trim()).filter(Boolean);

      const purge = await purgeMikhmonScriptsForMonth(conn, yearRaw, monthRaw, { preferredRawNames });
      return { purge };
    });

    res.json({
      ok: true,
      year: yearRaw,
      month: monthRaw,
      removed: result.purge.removed,
      failed: result.purge.failed,
      scanned: result.purge.scanned,
      cacheRowsDeleted: 0,
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de contacter le routeur" });
  }
});

router.get("/routers/:id/interfaces", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }
  const sc = routerCacheScope(r.ownerAdminId, id);
  const ck = `interfaces:${sc}`;
  const hit = mGet(ck);
  if (hit) { res.json(hit); return; }

  try {
    const conn: RouterConnection = { host: r.host, port: r.port, username: r.username, password: r.password };
    const ifaces = await listInterfaces(conn);
    mSet(ck, MIK_TTL.interfaces, ifaces);
    res.json(ifaces);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de contacter le routeur" });
  }
});

router.get("/routers/:id/traffic", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const ifaceName = typeof req.query.iface === "string" && req.query.iface ? req.query.iface : "";
  const live = req.query.live === "1";

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }
  const sc = routerCacheScope(r.ownerAdminId, id);
  const ck = `traffic:${sc}:${ifaceName}`;
  if (!live) {
    const fresh = mGet(ck);
    if (fresh) { res.json(fresh); return; }
  }

  const conn: RouterConnection = { host: r.host, port: r.port, username: r.username, password: r.password };

  try {
    const traffic = await fetchInterfaceTraffic(conn, ifaceName || undefined);
    if (!live) mSet(ck, MIK_TTL.traffic, traffic);
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
  const live = req.query.live === "1";
  const hotspotUserEventsOnly = req.query.hotspotUsers === "1";

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }
  const sc = routerCacheScope(r.ownerAdminId, id);
  const ck = `logs:${sc}:${topics}:${limit}:u${hotspotUserEventsOnly ? 1 : 0}`;
  if (!live) {
    const fresh = mGet(ck);
    if (fresh) { res.json(fresh); return; }
  }

  const conn = { host: r.host, port: r.port, username: r.username, password: r.password };

  try {
    const logs = await listLogs(conn, limit, topics || undefined, hotspotUserEventsOnly);
    if (!live) mSet(ck, MIK_TTL.logs, logs);
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
    const result = await disconnectSession(conn, user);
    res.json({ removed: result.removed, cookiesRemoved: result.cookiesRemoved, user });
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

router.post("/routers/:id/system/reboot", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }
  const conn = { host: r.host, port: r.port, username: r.username, password: r.password };
  try {
    await rebootRouter(conn);
    res.json({ success: true });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Erreur de connexion" });
  }
});

router.post("/routers/:id/system/shutdown", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }
  const conn = { host: r.host, port: r.port, username: r.username, password: r.password };
  try {
    await shutdownRouter(conn);
    res.json({ success: true });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Erreur de connexion" });
  }
});

// Info cache and usage sync are warmed on-demand when a router is first accessed.

export default router;
