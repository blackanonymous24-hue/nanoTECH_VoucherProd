import { Router } from "express";
import { eq, sql, and, or, isNull, asc } from "drizzle-orm";
import { db, adminSettingsTable, routersTable, vendorsTable } from "@workspace/db";
import { hashPassword } from "../lib/admin-auth.js";
import { requireSuperAdminScope } from "../lib/tenant.js";
import { getAdminCredentialPreview } from "../lib/admin-credential-preview.js";
import { pingRouter } from "../lib/mikrotik.js";
import { normalizeRouterConnection, mergeMikhmonHostPort, DEFAULT_ROUTER_API_PORT } from "../lib/router-host.js";
import {
  reconcileSalesCacheAfterConnectionChange,
  routerConnectionPatchChanged,
} from "../lib/router-sales-on-reconnect.js";
import { purgeRouterRowVolatileCaches } from "./routers.js";
import {
  adminLoginPasswordCollisionMessage,
  findAdminLoginPasswordHashCollision,
} from "../lib/admin-login-unique.js";

const router = Router();
const BASE_ROUTER_SLOTS = 5;
const CREDITS_PER_EXTRA_ROUTER = 10;

const TICKET_TEMPLATE_PRESET_IDS = new Set([
  "mikhmon-small",
  "nanotech-normal",
  "nanotech-small",
  "custom",
]);

function parseTicketTemplatePresetBody(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw === "string" && TICKET_TEMPLATE_PRESET_IDS.has(raw)) return raw;
  return undefined;
}

// Allowed forfait durations, in months. Maps the user-facing labels
// (1 mois … 6 mois, 1 an) to a single integer.
const VALID_MONTHS = new Set<number>([1, 2, 3, 4, 5, 6, 12]);

function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  d.setMonth(d.getMonth() + months);
  return d;
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

type ForfaitDuration = { kind: "months"; months: number } | { kind: "test24h" } | { kind: "unlimited" };

function parseForfaitDuration(body: unknown): ForfaitDuration | null {
  const b = (body ?? {}) as { months?: unknown; test24h?: unknown; unlimited?: unknown };
  if (b.unlimited === true) return { kind: "unlimited" };
  if (b.test24h === true) return { kind: "test24h" };
  const months = Number(b.months);
  if (VALID_MONTHS.has(months)) return { kind: "months", months };
  return null;
}

/** Premier super-admin en base (compte originel / seed). */
async function getOriginalSuperAdminId(): Promise<number | null> {
  const [row] = await db
    .select({ id: adminSettingsTable.id })
    .from(adminSettingsTable)
    .where(eq(adminSettingsTable.isSuperAdmin, true))
    .orderBy(asc(adminSettingsTable.id))
    .limit(1);
  return row?.id ?? null;
}

async function getAdminDeleteBlockReason(
  actor: { adminId: number },
  target: typeof adminSettingsTable.$inferSelect,
): Promise<string | null> {
  if (target.id === actor.adminId) {
    return "Vous ne pouvez pas supprimer votre propre compte";
  }
  if (!target.isSuperAdmin) return null;

  const originalId = await getOriginalSuperAdminId();
  if (originalId == null) return "Super administrateur originel introuvable";
  if (target.id === originalId) {
    return "Impossible de supprimer le super administrateur originel";
  }
  if (actor.adminId !== originalId) {
    return "Seul le super administrateur originel peut supprimer un autre super administrateur";
  }
  return null;
}

function canDeleteAdminForActor(
  actorId: number,
  target: typeof adminSettingsTable.$inferSelect,
  originalSuperAdminId: number | null,
): boolean {
  if (target.id === actorId) return false;
  if (!target.isSuperAdmin) return true;
  if (originalSuperAdminId == null) return false;
  return actorId === originalSuperAdminId && target.id !== originalSuperAdminId;
}

function publicAdminShape(
  a: typeof adminSettingsTable.$inferSelect,
  routerCount: number,
  opts?: { actorId: number; originalSuperAdminId: number | null },
) {
  const credentialPreview = getAdminCredentialPreview(a.id);
  return {
    id: a.id,
    login: a.login,
    displayName: a.displayName,
    isSuperAdmin: a.isSuperAdmin,
    canDelete: opts
      ? canDeleteAdminForActor(opts.actorId, a, opts.originalSuperAdminId)
      : undefined,
    isActive: a.isActive,
    forfaitStartedAt: a.forfaitStartedAt,
    forfaitEndsAt: a.forfaitEndsAt,
    forfaitActive: a.isSuperAdmin || (a.forfaitEndsAt ? a.forfaitEndsAt.getTime() > Date.now() : false),
    credits: a.credits,
    extraRouterSlots: a.extraRouterSlots,
    routerCount,
    routerLimit: 5 + a.extraRouterSlots,
    passwordPlain: a.passwordPlain ?? null,
    credentialPreview,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// GET /api/super/admins — list every admin (excluding super admins) + stats.
// Super admins are listed too but flagged so the UI can hide destructive
// actions on them.
// ---------------------------------------------------------------------------
router.get("/super/admins", async (req, res): Promise<void> => {
  const scope = requireSuperAdminScope(req, res);
  if (!scope) return;

  // Single query: admin rows + their router count via LEFT JOIN + GROUP BY.
  const rows = await db
    .select({
      admin: adminSettingsTable,
      routerCount: sql<number>`coalesce(count(${routersTable.id})::int, 0)`,
    })
    .from(adminSettingsTable)
    .leftJoin(routersTable, eq(routersTable.ownerAdminId, adminSettingsTable.id))
    .groupBy(adminSettingsTable.id)
    .orderBy(adminSettingsTable.id);

  const originalSuperAdminId = await getOriginalSuperAdminId();
  const shapeOpts = { actorId: scope.adminId, originalSuperAdminId };
  res.json({
    originalSuperAdminId,
    viewerIsOriginalSuperAdmin:
      originalSuperAdminId != null && scope.adminId === originalSuperAdminId,
    admins: rows.map((r) => publicAdminShape(r.admin, Number(r.routerCount), shapeOpts)),
  });
});

// ---------------------------------------------------------------------------
// POST /api/super/admins — create a new (regular) admin tenant.
// Body: { login, password, displayName?, forfaitMonths?, credits? }
// ---------------------------------------------------------------------------
router.post("/super/admins", async (req, res): Promise<void> => {
  if (!requireSuperAdminScope(req, res)) return;

  const { login, password, displayName, forfaitMonths, forfaitTest24h, forfaitUnlimited, credits, isSuperAdmin: makeSuper, verificationCode } = req.body as {
    login?: string;
    password?: string;
    displayName?: string;
    forfaitMonths?: number;
    forfaitTest24h?: boolean;
    forfaitUnlimited?: boolean;
    credits?: number;
    isSuperAdmin?: boolean;
    verificationCode?: string;
  };

  const loginTrimmed = login?.trim() ?? "";
  if (!loginTrimmed || !password) {
    res.status(400).json({ error: "Login et mot de passe requis" });
    return;
  }
  if (loginTrimmed.length < 1) {
    res.status(400).json({ error: "Login requis" });
    return;
  }
  if (password.length < 1) {
    res.status(400).json({ error: "Mot de passe requis" });
    return;
  }

  const loginPasswordCollision = await adminLoginPasswordCollisionMessage(loginTrimmed, password);
  if (loginPasswordCollision) {
    res.status(409).json({ error: loginPasswordCollision });
    return;
  }

  let forfaitStartedAt: Date | null = null;
  let forfaitEndsAt: Date | null   = null;
  if (forfaitUnlimited === true) {
    forfaitStartedAt = new Date();
    forfaitEndsAt = null;
  } else if (forfaitTest24h === true) {
    forfaitStartedAt = new Date();
    forfaitEndsAt = addHours(forfaitStartedAt, 24);
  } else if (forfaitMonths !== undefined && forfaitMonths !== null) {
    if (!VALID_MONTHS.has(forfaitMonths)) {
      res.status(400).json({ error: "Durée de forfait invalide (test 24h ou 1, 2, 3, 4, 5, 6, 12 mois)" });
      return;
    }
    forfaitStartedAt = new Date();
    forfaitEndsAt = addMonths(forfaitStartedAt, forfaitMonths);
  }

  const initialCredits = Math.max(0, Number.isFinite(credits) ? Math.trunc(credits as number) : 0);

  const passwordHash = await hashPassword(password);
  const [created] = await db
    .insert(adminSettingsTable)
    .values({
      login: loginTrimmed,
      passwordHash,
      passwordPlain: password,
      displayName: displayName?.trim() || null,
      isSuperAdmin: makeSuper === true,
      verificationCode: verificationCode?.trim() || null,
      isActive: true,
      forfaitStartedAt,
      forfaitEndsAt,
      credits: initialCredits,
      extraRouterSlots: 0,
    })
    .returning();

  res.status(201).json(publicAdminShape(created, 0));
});

// ---------------------------------------------------------------------------
// PATCH /api/super/admins/:id — update display name, password, active flag.
// Body: { displayName?, password?, isActive?, login? }
// ---------------------------------------------------------------------------
router.patch("/super/admins/:id", async (req, res): Promise<void> => {
  const scope = requireSuperAdminScope(req, res);
  if (!scope) return;

  const id = parseInt(req.params.id, 10);
  if (!id || Number.isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [target] = await db.select().from(adminSettingsTable).where(eq(adminSettingsTable.id, id));
  if (!target) { res.status(404).json({ error: "Admin introuvable" }); return; }
  if (target.isSuperAdmin) {
    res.status(403).json({ error: "Impossible de modifier un super administrateur via cette API" });
    return;
  }

  const { displayName, password, isActive, login } = req.body as {
    displayName?: string | null;
    password?: string;
    isActive?: boolean;
    login?: string;
  };

  const patch: Partial<typeof adminSettingsTable.$inferInsert> = {};
  if (displayName !== undefined) patch.displayName = displayName?.trim() || null;
  if (typeof isActive === "boolean") patch.isActive = isActive;
  if (login !== undefined) {
    const loginTrimmed = login.trim();
    if (loginTrimmed.length < 1) {
      res.status(400).json({ error: "Login requis" });
      return;
    }
    patch.login = loginTrimmed;
  }
  if (password !== undefined) {
    if (password.length < 1) {
      res.status(400).json({ error: "Mot de passe requis" });
      return;
    }
    patch.passwordHash = await hashPassword(password);
    patch.passwordPlain = password;
  }

  const nextLogin = patch.login ?? target.login;
  if (password !== undefined) {
    const collision = await adminLoginPasswordCollisionMessage(nextLogin, password, id);
    if (collision) {
      res.status(409).json({ error: collision });
      return;
    }
  } else if (patch.login !== undefined) {
    const hashHit = await findAdminLoginPasswordHashCollision(nextLogin, target.passwordHash, id);
    if (hashHit) {
      const kind = hashHit.isSuperAdmin ? "super administrateur" : "administrateur";
      res.status(409).json({
        error: `Un compte ${kind} utilise déjà cet identifiant avec le même mot de passe.`,
      });
      return;
    }
  }

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "Aucun champ à mettre à jour" });
    return;
  }

  const [updated] = await db
    .update(adminSettingsTable)
    .set(patch)
    .where(eq(adminSettingsTable.id, id))
    .returning();

  // Get fresh router count (cheap; rarely called).
  const [{ count: routerCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(routersTable)
    .where(eq(routersTable.ownerAdminId, id));

  res.json(publicAdminShape(updated, Number(routerCount)));
});

// ---------------------------------------------------------------------------
// DELETE /api/super/admins/:id — hard delete a regular admin.
// Cascades to their routers (and through routers to managers/vendors/vouchers
// thanks to the existing router_id FK chain), thanks to ON DELETE CASCADE
// on owner_admin_id.
// ---------------------------------------------------------------------------
router.delete("/super/admins/:id", async (req, res): Promise<void> => {
  const scope = requireSuperAdminScope(req, res);
  if (!scope) return;

  const id = parseInt(req.params.id, 10);
  if (!id || Number.isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [target] = await db.select().from(adminSettingsTable).where(eq(adminSettingsTable.id, id));
  if (!target) { res.status(404).json({ error: "Admin introuvable" }); return; }

  const blockReason = await getAdminDeleteBlockReason(scope, target);
  if (blockReason) {
    res.status(403).json({ error: blockReason });
    return;
  }

  await db.delete(adminSettingsTable).where(eq(adminSettingsTable.id, id));
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /api/super/admins/:id/forfait — set / reset a forfait.
// Body: { months: 1|2|3|4|5|6|12 } OR { test24h: true }
// Replaces any existing forfait. Starts now, ends now + N months.
// ---------------------------------------------------------------------------
router.post("/super/admins/:id/forfait", async (req, res): Promise<void> => {
  if (!requireSuperAdminScope(req, res)) return;

  const id = parseInt(req.params.id, 10);
  if (!id || Number.isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const duration = parseForfaitDuration(req.body);
  if (!duration) {
    res.status(400).json({ error: "Durée invalide (test 24h ou 1, 2, 3, 4, 5, 6, 12 mois)" });
    return;
  }

  const [target] = await db.select().from(adminSettingsTable).where(eq(adminSettingsTable.id, id));
  if (!target) { res.status(404).json({ error: "Admin introuvable" }); return; }
  if (target.isSuperAdmin) {
    res.status(400).json({ error: "Le super administrateur n'a pas de forfait" });
    return;
  }

  const start = new Date();
  const end = duration.kind === "unlimited"
    ? null
    : duration.kind === "test24h"
    ? addHours(start, 24)
    : addMonths(start, duration.months);
  const [updated] = await db
    .update(adminSettingsTable)
    .set({ forfaitStartedAt: start, forfaitEndsAt: end })
    .where(eq(adminSettingsTable.id, id))
    .returning();
  const [{ count: routerCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(routersTable)
    .where(eq(routersTable.ownerAdminId, id));
  res.json(publicAdminShape(updated, Number(routerCount)));
});

// ---------------------------------------------------------------------------
// POST /api/super/admins/:id/forfait/extend — extend an active or expired
// forfait by N months. If the current forfait is already expired (or never
// existed) we extend from "now"; otherwise we extend from the existing end
// date so days don't get lost.
// Body: { months: 1|2|3|4|5|6|12 } OR { test24h: true }
// ---------------------------------------------------------------------------
router.post("/super/admins/:id/forfait/extend", async (req, res): Promise<void> => {
  if (!requireSuperAdminScope(req, res)) return;

  const id = parseInt(req.params.id, 10);
  if (!id || Number.isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const duration = parseForfaitDuration(req.body);
  if (!duration) {
    res.status(400).json({ error: "Durée invalide (test 24h ou 1, 2, 3, 4, 5, 6, 12 mois)" });
    return;
  }

  const [target] = await db.select().from(adminSettingsTable).where(eq(adminSettingsTable.id, id));
  if (!target) { res.status(404).json({ error: "Admin introuvable" }); return; }
  if (target.isSuperAdmin) {
    res.status(400).json({ error: "Le super administrateur n'a pas de forfait" });
    return;
  }

  const now = new Date();
  if (duration.kind === "unlimited") {
    const [updated] = await db
      .update(adminSettingsTable)
      .set({ forfaitStartedAt: now, forfaitEndsAt: null })
      .where(eq(adminSettingsTable.id, id))
      .returning();
    const [{ count: routerCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(routersTable)
      .where(eq(routersTable.ownerAdminId, id));
    res.json(publicAdminShape(updated, Number(routerCount)));
    return;
  }
  const baseEnd  = target.forfaitEndsAt && target.forfaitEndsAt.getTime() > now.getTime()
    ? target.forfaitEndsAt
    : now;
  const newEnd = duration.kind === "test24h" ? addHours(baseEnd, 24) : addMonths(baseEnd, duration.months);
  // forfaitStartedAt stays as-is if the forfait is still active; otherwise
  // we reset it to "now" so the next billing window has a sane start.
  const newStart = target.forfaitStartedAt && target.forfaitEndsAt && target.forfaitEndsAt.getTime() > now.getTime()
    ? target.forfaitStartedAt
    : now;
  const [updated] = await db
    .update(adminSettingsTable)
    .set({ forfaitStartedAt: newStart, forfaitEndsAt: newEnd })
    .where(eq(adminSettingsTable.id, id))
    .returning();
  const [{ count: routerCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(routersTable)
    .where(eq(routersTable.ownerAdminId, id));
  res.json(publicAdminShape(updated, Number(routerCount)));
});

// ---------------------------------------------------------------------------
// POST /api/super/admins/:id/credits — allocate (or revoke) credits.
// Body: { delta: number }   // positive to add, negative to subtract
// Resulting balance is clamped at 0 (can't go negative).
// ---------------------------------------------------------------------------
router.post("/super/admins/:id/credits", async (req, res): Promise<void> => {
  if (!requireSuperAdminScope(req, res)) return;

  const id = parseInt(req.params.id, 10);
  if (!id || Number.isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const delta = Math.trunc(Number((req.body ?? {}).delta));
  if (!Number.isFinite(delta) || delta === 0) {
    res.status(400).json({ error: "Delta invalide" });
    return;
  }

  const [target] = await db.select().from(adminSettingsTable).where(eq(adminSettingsTable.id, id));
  if (!target) { res.status(404).json({ error: "Admin introuvable" }); return; }
  if (target.isSuperAdmin) {
    res.status(400).json({ error: "Le super administrateur a des crédits illimités" });
    return;
  }

  // Clamp at 0 (greatest(credits + delta, 0)).
  const [updated] = await db
    .update(adminSettingsTable)
    .set({ credits: sql`greatest(${adminSettingsTable.credits} + ${delta}, 0)` })
    .where(eq(adminSettingsTable.id, id))
    .returning();
  const [{ count: routerCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(routersTable)
    .where(eq(routersTable.ownerAdminId, id));
  res.json(publicAdminShape(updated, Number(routerCount)));
});

// ---------------------------------------------------------------------------
// GET /api/super/admins/:id/routers — liste des routeurs dont l’admin cible est
// propriétaire (`owner_admin_id`), y compris pour un compte super-admin.
// Même forme que GET /api/routers pour l’admin connecté.
// ---------------------------------------------------------------------------
router.get("/super/admins/:id/routers", async (req, res): Promise<void> => {
  const scope = requireSuperAdminScope(req, res);
  if (!scope) return;

  const adminId = parseInt(req.params.id, 10);
  if (!adminId || Number.isNaN(adminId)) { res.status(400).json({ error: "ID admin invalide" }); return; }

  const [target] = await db.select().from(adminSettingsTable).where(eq(adminSettingsTable.id, adminId));
  if (!target) { res.status(404).json({ error: "Admin introuvable" }); return; }

  // Routeurs dont owner_admin_id = adminId. Pour votre propre compte super-admin,
  // si un seul super existe sur la plateforme, inclure aussi les lignes legacy
  // (owner_admin_id NULL) — sinon elles n'apparaissaient nulle part.
  let ownerFilter = eq(routersTable.ownerAdminId, adminId);
  if (target.isSuperAdmin && scope.adminId === adminId) {
    const [{ superCount }] = await db
      .select({ superCount: sql<number>`count(*)::int` })
      .from(adminSettingsTable)
      .where(eq(adminSettingsTable.isSuperAdmin, true));
    if (Number(superCount) === 1) {
      ownerFilter = or(eq(routersTable.ownerAdminId, adminId), isNull(routersTable.ownerAdminId))!;
    }
  }

  const rows = await db
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
    .from(routersTable)
    .where(ownerFilter)
    .orderBy(asc(routersTable.createdAt), asc(routersTable.id));
  res.json(rows);
});

// ---------------------------------------------------------------------------
// PUT /api/super/admins/:id/routers/:routerId — modifie un routeur de l'admin cible.
// ---------------------------------------------------------------------------
router.put("/super/admins/:id/routers/:routerId", async (req, res): Promise<void> => {
  if (!requireSuperAdminScope(req, res)) return;

  const adminId = parseInt(req.params.id, 10);
  const routerId = parseInt(req.params.routerId, 10);
  if (!adminId || isNaN(adminId) || !routerId || isNaN(routerId)) {
    res.status(400).json({ error: "ID invalide" }); return;
  }

  const [r] = await db
    .select({
      host: routersTable.host,
      port: routersTable.port,
      username: routersTable.username,
      password: routersTable.password,
      mikrotikSerial: routersTable.mikrotikSerial,
    })
    .from(routersTable)
    .where(and(eq(routersTable.id, routerId), eq(routersTable.ownerAdminId, adminId)));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  const { name, hotspotName, contact, currency, host, port, username, password } = req.body as {
    name?: string; hotspotName?: string; contact?: string; currency?: string;
    host?: string; port?: number; username?: string; password?: string;
  };

  const updates: Partial<typeof routersTable.$inferInsert> = {};
  if (name !== undefined) updates.name = name;
  if (hotspotName !== undefined) updates.hotspotName = hotspotName || null;
  if (contact !== undefined) updates.contact = contact || null;
  if (currency !== undefined) updates.currency = currency.trim().slice(0, 24) || "FCFA";
  if (host !== undefined) {
    const merged = mergeMikhmonHostPort(host, port);
    if (!merged.host) {
      res.status(400).json({ error: "Adresse IP ou hôte invalide" });
      return;
    }
    updates.host = merged.host;
    updates.port = merged.port;
  } else if (port !== undefined) {
    updates.port = port > 0 ? port : DEFAULT_ROUTER_API_PORT;
  }
  if (username !== undefined) updates.username = username;
  if (password !== undefined && password !== "") updates.password = password;

  const connPatch = { host, port, username, password };
  let salesReset: Awaited<ReturnType<typeof reconcileSalesCacheAfterConnectionChange>> | null = null;
  if (routerConnectionPatchChanged(r, connPatch)) {
    salesReset = await reconcileSalesCacheAfterConnectionChange(routerId, r, connPatch);
    updates.mikrotikSerial = salesReset.mikrotikSerial;
  }

  const [updated] = await db.update(routersTable)
    .set(updates)
    .where(and(eq(routersTable.id, routerId), eq(routersTable.ownerAdminId, adminId)))
    .returning();

  if (updated) purgeRouterRowVolatileCaches(adminId, routerId);
  res.json({
    ...updated,
    ...(salesReset?.salesCacheCleared
      ? {
          salesCacheCleared: true,
          salesCacheMessage:
            "Cache ventes réinitialisé : nouvelle adresse ou autre MikroTik détecté.",
        }
      : {}),
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/super/admins/:id/routers/:routerId — supprime un routeur de l'admin cible.
// ---------------------------------------------------------------------------
router.delete("/super/admins/:id/routers/:routerId", async (req, res): Promise<void> => {
  if (!requireSuperAdminScope(req, res)) return;

  const adminId = parseInt(req.params.id, 10);
  const routerId = parseInt(req.params.routerId, 10);
  if (!adminId || isNaN(adminId) || !routerId || isNaN(routerId)) {
    res.status(400).json({ error: "ID invalide" }); return;
  }

  const [deleted] = await db.delete(routersTable)
    .where(and(eq(routersTable.id, routerId), eq(routersTable.ownerAdminId, adminId)))
    .returning();
  if (!deleted) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  res.sendStatus(204);
});

// ---------------------------------------------------------------------------
// GET /api/super/admins/:id/routers/:routerId/ping — TCP ping d'un routeur
// sans passer par le middleware tenant (super-admin peut ping n'importe quel routeur).
// ---------------------------------------------------------------------------
router.get("/super/admins/:id/routers/:routerId/ping", async (req, res): Promise<void> => {
  if (!requireSuperAdminScope(req, res)) return;

  const routerId = parseInt(req.params.routerId, 10);
  if (isNaN(routerId)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, routerId));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  const conn = normalizeRouterConnection({
    host: r.host,
    port: r.port,
    username: r.username,
    password: r.password,
  });
  const online = await pingRouter(conn);
  res.json({ success: online, host: conn.host, port: conn.port });
});

// ---------------------------------------------------------------------------
// GET /api/super/all-routers — list every router in the system with its owner info.
// Used by super-admin to pick a router to copy into another admin's account.
// ---------------------------------------------------------------------------
router.get("/super/all-routers", async (req, res): Promise<void> => {
  if (!requireSuperAdminScope(req, res)) return;

  const rows = await db
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
      isActive: routersTable.isActive,
      ownerAdminId: routersTable.ownerAdminId,
      ownerLogin: adminSettingsTable.login,
      ownerDisplayName: adminSettingsTable.displayName,
    })
    .from(routersTable)
    .leftJoin(adminSettingsTable, eq(adminSettingsTable.id, routersTable.ownerAdminId))
    .orderBy(adminSettingsTable.id, routersTable.name);

  res.json(rows);
});

// POST /api/super/admins/:id/routers — create a router for a target admin.
// Super-admin : pas de plafond ni de débit crédit pour extraRouterSlots.
// Body: { name, host, port?, username, password, hotspotName?, contact?, isActive? }
// ---------------------------------------------------------------------------
router.post("/super/admins/:id/routers", async (req, res): Promise<void> => {
  if (!requireSuperAdminScope(req, res)) return;

  const adminId = parseInt(req.params.id, 10);
  if (!adminId || Number.isNaN(adminId)) { res.status(400).json({ error: "ID admin invalide" }); return; }

  const [target] = await db.select().from(adminSettingsTable).where(eq(adminSettingsTable.id, adminId));
  if (!target) { res.status(404).json({ error: "Admin introuvable" }); return; }
  if (!target.isActive) { res.status(400).json({ error: "Admin désactivé" }); return; }

  const { name, hotspotName, contact, currency, host, port, username, password, isActive } = req.body as {
    name?: string;
    hotspotName?: string;
    contact?: string;
    currency?: string;
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    isActive?: boolean;
  };

  if (!name?.trim() || !host?.trim() || !username?.trim() || !password?.trim()) {
    res.status(400).json({ error: "name, host, username et password sont requis" });
    return;
  }

  // Admins classiques : plafond 5 + extraRouterSlots, extension auto si crédits suffisants.
  if (!target.isSuperAdmin) {
    const limit = BASE_ROUTER_SLOTS + target.extraRouterSlots;
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(routersTable)
      .where(eq(routersTable.ownerAdminId, adminId));
    if (Number(count) >= limit) {
      const autoExpanded = await db
        .update(adminSettingsTable)
        .set({
          credits: sql`${adminSettingsTable.credits} - ${CREDITS_PER_EXTRA_ROUTER}`,
          extraRouterSlots: sql`${adminSettingsTable.extraRouterSlots} + 1`,
        })
        .where(and(
          eq(adminSettingsTable.id, adminId),
          sql`${adminSettingsTable.credits} >= ${CREDITS_PER_EXTRA_ROUTER}`,
        ))
        .returning({ id: adminSettingsTable.id });
      if (autoExpanded.length === 0) {
        res.status(402).json({ error: `Limite atteinte (${limit} routeurs). Crédit insuffisant: ${CREDITS_PER_EXTRA_ROUTER} requis pour ajouter 1 routeur.` });
        return;
      }
    }
  }

  const currencyNorm = (currency ?? "FCFA").trim().slice(0, 24) || "FCFA";
  const { host: hostNorm, port: portNorm } = mergeMikhmonHostPort(host, port);
  if (!hostNorm) {
    res.status(400).json({ error: "Adresse IP ou hôte invalide" });
    return;
  }

  const [created] = await db
    .insert(routersTable)
    .values({
      ownerAdminId: adminId,
      name: name.trim(),
      hotspotName: hotspotName?.trim() || null,
      contact: contact?.trim() || null,
      currency: currencyNorm,
      host: hostNorm,
      port: portNorm,
      username: username.trim(),
      password: password.trim(),
      isActive: isActive ?? true,
    })
    .returning();

  res.status(201).json(created);
});

// ---------------------------------------------------------------------------
// GET /api/super/admins/:id/ticket-template — super admin lit le modèle d'un admin.
// ---------------------------------------------------------------------------
router.get("/super/admins/:id/ticket-template", async (req, res): Promise<void> => {
  if (!requireSuperAdminScope(req, res)) return;

  const id = parseInt(req.params.id, 10);
  if (!id || Number.isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [row] = await db
    .select({
      ticketTemplate: adminSettingsTable.ticketTemplate,
      ticketTemplatePreset: adminSettingsTable.ticketTemplatePreset,
    })
    .from(adminSettingsTable)
    .where(eq(adminSettingsTable.id, id));
  if (!row) { res.status(404).json({ error: "Admin introuvable" }); return; }

  res.json({
    template: row.ticketTemplate ?? null,
    presetId: row.ticketTemplatePreset ?? null,
  });
});

// ---------------------------------------------------------------------------
// PUT /api/super/admins/:id/ticket-template — body: { template: string, presetId?: string | null }
// ---------------------------------------------------------------------------
router.put("/super/admins/:id/ticket-template", async (req, res): Promise<void> => {
  if (!requireSuperAdminScope(req, res)) return;

  const id = parseInt(req.params.id, 10);
  if (!id || Number.isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const { template, presetId } = req.body as { template?: unknown; presetId?: unknown };
  if (typeof template !== "string") {
    res.status(400).json({ error: "Champ template requis (string)" });
    return;
  }

  const [target] = await db.select().from(adminSettingsTable).where(eq(adminSettingsTable.id, id));
  if (!target) { res.status(404).json({ error: "Admin introuvable" }); return; }

  const presetField = parseTicketTemplatePresetBody(presetId);
  const setPayload: {
    ticketTemplate: string | null;
    ticketTemplatePreset?: string | null;
  } = { ticketTemplate: template.trim() || null };
  if (presetField !== undefined) {
    setPayload.ticketTemplatePreset = presetField;
  }

  const [updated] = await db
    .update(adminSettingsTable)
    .set(setPayload)
    .where(eq(adminSettingsTable.id, id))
    .returning();

  const [{ count: routerCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(routersTable)
    .where(eq(routersTable.ownerAdminId, id));

  res.json(publicAdminShape(updated, Number(routerCount)));
});

// ---------------------------------------------------------------------------
// GET /api/super/own-routers — routeurs appartenant au super-admin lui-même
// (ownerAdminId = superAdminId). Utilisé pour le sélecteur "Vendeurs du routeur".
// ---------------------------------------------------------------------------
router.get("/super/own-routers", async (req, res): Promise<void> => {
  const scope = requireSuperAdminScope(req, res);
  if (!scope) return;

  const [{ superCount }] = await db
    .select({ superCount: sql<number>`count(*)::int` })
    .from(adminSettingsTable)
    .where(eq(adminSettingsTable.isSuperAdmin, true));
  const ownerFilter = Number(superCount) === 1
    ? or(eq(routersTable.ownerAdminId, scope.adminId), isNull(routersTable.ownerAdminId))
    : eq(routersTable.ownerAdminId, scope.adminId);

  const rows = await db
    .select({ id: routersTable.id, name: routersTable.name, host: routersTable.host, port: routersTable.port })
    .from(routersTable)
    .where(ownerFilter)
    .orderBy(asc(routersTable.createdAt), asc(routersTable.id));
  res.json(rows);
});

// ---------------------------------------------------------------------------
// POST /api/super/copy-vendors
// Body: { fromRouterId: number, toRouterId: number, targetAdminId: number }
// Copie les vendeurs du routeur source vers le routeur cible.
// Source autorisée : routeur du super-admin OU routeur de l'admin cible (copie A→B).
// Cible : routeur de l'admin cible uniquement. fromRouterId ≠ toRouterId.
// Les vendeurs dont le username existe déjà sur le routeur cible sont ignorés.
// Réponse: { copied: number, skipped: number }
// ---------------------------------------------------------------------------
router.post("/super/copy-vendors", async (req, res): Promise<void> => {
  const scope = requireSuperAdminScope(req, res);
  if (!scope) return;

  const { fromRouterId, toRouterId, targetAdminId } = (req.body ?? {}) as {
    fromRouterId?: unknown; toRouterId?: unknown; targetAdminId?: unknown;
  };

  const fromId = parseInt(String(fromRouterId), 10);
  const toId   = parseInt(String(toRouterId), 10);
  const toAdminId = parseInt(String(targetAdminId), 10);

  if (!fromId || isNaN(fromId) || !toId || isNaN(toId) || !toAdminId || isNaN(toAdminId)) {
    res.status(400).json({ error: "fromRouterId, toRouterId et targetAdminId sont requis" });
    return;
  }

  if (fromId === toId) {
    res.status(400).json({ error: "Le routeur source et le routeur cible doivent être différents." });
    return;
  }

  // Routeur source : vôtre routeur (modèle) OU routeur de l'admin cible (copie interne A→B)
  const [srcRouter] = await db.select({ id: routersTable.id })
    .from(routersTable)
    .where(and(
      eq(routersTable.id, fromId),
      or(eq(routersTable.ownerAdminId, scope.adminId), eq(routersTable.ownerAdminId, toAdminId)),
    ));
  if (!srcRouter) {
    res.status(403).json({
      error: "Routeur source introuvable ou non autorisé (doit être le vôtre ou appartenir à l'administrateur cible).",
    });
    return;
  }

  // Vérifier que le routeur cible appartient à l'admin cible
  const [dstRouter] = await db.select({ id: routersTable.id })
    .from(routersTable)
    .where(and(eq(routersTable.id, toId), eq(routersTable.ownerAdminId, toAdminId)));
  if (!dstRouter) {
    res.status(403).json({ error: "Routeur cible introuvable ou n'appartient pas à cet admin" });
    return;
  }

  // Vendeurs source
  const srcVendors = await db.select().from(vendorsTable).where(eq(vendorsTable.routerId, fromId));
  if (srcVendors.length === 0) {
    res.json({ copied: 0, skipped: 0 });
    return;
  }

  // Usernames déjà présents sur le routeur cible (pour éviter les doublons)
  const dstVendors = await db
    .select({ username: vendorsTable.username })
    .from(vendorsTable)
    .where(eq(vendorsTable.routerId, toId));
  const existingUsernames = new Set(dstVendors.map((v) => v.username).filter(Boolean));

  const toInsert = srcVendors.filter((v) => !v.username || !existingUsernames.has(v.username));
  const skipped  = srcVendors.length - toInsert.length;

  if (toInsert.length > 0) {
    await db.insert(vendorsTable).values(
      toInsert.map(({ id: _id, createdAt: _c, updatedAt: _u, ...rest }) => ({
        ...rest,
        routerId: toId,
        ownerAdminId: toAdminId,
      })),
    );
  }

  res.json({ copied: toInsert.length, skipped });
});

export default router;
