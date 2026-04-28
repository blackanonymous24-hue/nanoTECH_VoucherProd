import { Router } from "express";
import { eq, sql, and, ne } from "drizzle-orm";
import { db, adminSettingsTable, routersTable } from "@workspace/db";
import { hashPassword } from "../lib/admin-auth.js";
import { requireSuperAdminScope } from "../lib/tenant.js";

const router = Router();

// Allowed forfait durations, in months. Maps the user-facing labels
// (1 mois … 6 mois, 1 an) to a single integer.
const VALID_MONTHS = new Set<number>([1, 2, 3, 4, 5, 6, 12]);

function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  d.setMonth(d.getMonth() + months);
  return d;
}

function publicAdminShape(a: typeof adminSettingsTable.$inferSelect, routerCount: number) {
  return {
    id: a.id,
    login: a.login,
    displayName: a.displayName,
    isSuperAdmin: a.isSuperAdmin,
    isActive: a.isActive,
    forfaitStartedAt: a.forfaitStartedAt,
    forfaitEndsAt: a.forfaitEndsAt,
    forfaitActive: a.isSuperAdmin || (a.forfaitEndsAt ? a.forfaitEndsAt.getTime() > Date.now() : false),
    credits: a.credits,
    extraRouterSlots: a.extraRouterSlots,
    routerCount,
    routerLimit: 5 + a.extraRouterSlots,
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
  if (!requireSuperAdminScope(req, res)) return;

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

  res.json({
    admins: rows.map((r) => publicAdminShape(r.admin, Number(r.routerCount))),
  });
});

// ---------------------------------------------------------------------------
// POST /api/super/admins — create a new (regular) admin tenant.
// Body: { login, password, displayName?, forfaitMonths?, credits? }
// ---------------------------------------------------------------------------
router.post("/super/admins", async (req, res): Promise<void> => {
  if (!requireSuperAdminScope(req, res)) return;

  const { login, password, displayName, forfaitMonths, credits } = req.body as {
    login?: string;
    password?: string;
    displayName?: string;
    forfaitMonths?: number;
    credits?: number;
  };

  const loginTrimmed = login?.trim() ?? "";
  if (!loginTrimmed || !password) {
    res.status(400).json({ error: "Login et mot de passe requis" });
    return;
  }
  if (loginTrimmed.length < 3) {
    res.status(400).json({ error: "Login trop court (min 3 caractères)" });
    return;
  }
  if (password.length < 4) {
    res.status(400).json({ error: "Mot de passe trop court (min 4 caractères)" });
    return;
  }

  let forfaitStartedAt: Date | null = null;
  let forfaitEndsAt: Date | null   = null;
  if (forfaitMonths !== undefined && forfaitMonths !== null) {
    if (!VALID_MONTHS.has(forfaitMonths)) {
      res.status(400).json({ error: "Durée de forfait invalide (1, 2, 3, 4, 5, 6 ou 12 mois)" });
      return;
    }
    forfaitStartedAt = new Date();
    forfaitEndsAt    = addMonths(forfaitStartedAt, forfaitMonths);
  }

  const initialCredits = Math.max(0, Number.isFinite(credits) ? Math.trunc(credits as number) : 0);

  // Detect login collision up-front for a clean 409 (the unique index would
  // also prevent it, but the error message is friendlier).
  const existing = await db.select({ id: adminSettingsTable.id }).from(adminSettingsTable).where(eq(adminSettingsTable.login, loginTrimmed));
  if (existing.length > 0) {
    res.status(409).json({ error: "Ce login est déjà utilisé" });
    return;
  }

  const passwordHash = await hashPassword(password);
  const [created] = await db
    .insert(adminSettingsTable)
    .values({
      login: loginTrimmed,
      passwordHash,
      displayName: displayName?.trim() || null,
      isSuperAdmin: false,
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
    if (loginTrimmed.length < 3) {
      res.status(400).json({ error: "Login trop court (min 3 caractères)" });
      return;
    }
    // Collision check (excluding self).
    const dup = await db.select({ id: adminSettingsTable.id })
      .from(adminSettingsTable)
      .where(and(eq(adminSettingsTable.login, loginTrimmed), ne(adminSettingsTable.id, id)));
    if (dup.length > 0) { res.status(409).json({ error: "Login déjà utilisé" }); return; }
    patch.login = loginTrimmed;
  }
  if (password !== undefined) {
    if (password.length < 4) {
      res.status(400).json({ error: "Mot de passe trop court (min 4 caractères)" });
      return;
    }
    patch.passwordHash = await hashPassword(password);
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
  if (!requireSuperAdminScope(req, res)) return;

  const id = parseInt(req.params.id, 10);
  if (!id || Number.isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [target] = await db.select().from(adminSettingsTable).where(eq(adminSettingsTable.id, id));
  if (!target) { res.status(404).json({ error: "Admin introuvable" }); return; }
  if (target.isSuperAdmin) {
    res.status(403).json({ error: "Impossible de supprimer un super administrateur" });
    return;
  }

  await db.delete(adminSettingsTable).where(eq(adminSettingsTable.id, id));
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /api/super/admins/:id/forfait — set / reset a forfait.
// Body: { months: 1|2|3|4|5|6|12 }
// Replaces any existing forfait. Starts now, ends now + N months.
// ---------------------------------------------------------------------------
router.post("/super/admins/:id/forfait", async (req, res): Promise<void> => {
  if (!requireSuperAdminScope(req, res)) return;

  const id = parseInt(req.params.id, 10);
  if (!id || Number.isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const months = Number((req.body ?? {}).months);
  if (!VALID_MONTHS.has(months)) {
    res.status(400).json({ error: "Durée invalide (1, 2, 3, 4, 5, 6 ou 12 mois)" });
    return;
  }

  const [target] = await db.select().from(adminSettingsTable).where(eq(adminSettingsTable.id, id));
  if (!target) { res.status(404).json({ error: "Admin introuvable" }); return; }
  if (target.isSuperAdmin) {
    res.status(400).json({ error: "Le super administrateur n'a pas de forfait" });
    return;
  }

  const start = new Date();
  const end   = addMonths(start, months);
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
// Body: { months: 1|2|3|4|5|6|12 }
// ---------------------------------------------------------------------------
router.post("/super/admins/:id/forfait/extend", async (req, res): Promise<void> => {
  if (!requireSuperAdminScope(req, res)) return;

  const id = parseInt(req.params.id, 10);
  if (!id || Number.isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }
  const months = Number((req.body ?? {}).months);
  if (!VALID_MONTHS.has(months)) {
    res.status(400).json({ error: "Durée invalide (1, 2, 3, 4, 5, 6 ou 12 mois)" });
    return;
  }

  const [target] = await db.select().from(adminSettingsTable).where(eq(adminSettingsTable.id, id));
  if (!target) { res.status(404).json({ error: "Admin introuvable" }); return; }
  if (target.isSuperAdmin) {
    res.status(400).json({ error: "Le super administrateur n'a pas de forfait" });
    return;
  }

  const now = new Date();
  const baseEnd  = target.forfaitEndsAt && target.forfaitEndsAt.getTime() > now.getTime()
    ? target.forfaitEndsAt
    : now;
  const newEnd   = addMonths(baseEnd, months);
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
// POST /api/super/admins/:id/routers — create a router for a target admin.
// Body: { name, host, port?, username, password, hotspotName?, contact?, isActive? }
// ---------------------------------------------------------------------------
router.post("/super/admins/:id/routers", async (req, res): Promise<void> => {
  if (!requireSuperAdminScope(req, res)) return;

  const adminId = parseInt(req.params.id, 10);
  if (!adminId || Number.isNaN(adminId)) { res.status(400).json({ error: "ID admin invalide" }); return; }

  const [target] = await db.select().from(adminSettingsTable).where(eq(adminSettingsTable.id, adminId));
  if (!target) { res.status(404).json({ error: "Admin introuvable" }); return; }
  if (target.isSuperAdmin) { res.status(400).json({ error: "Routeur direct non supporté pour super admin" }); return; }
  if (!target.isActive) { res.status(400).json({ error: "Admin désactivé" }); return; }

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

  if (!name?.trim() || !host?.trim() || !username?.trim() || !password?.trim()) {
    res.status(400).json({ error: "name, host, username et password sont requis" });
    return;
  }

  const limit = 5 + target.extraRouterSlots;
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(routersTable)
    .where(eq(routersTable.ownerAdminId, adminId));
  if (Number(count) >= limit) {
    res.status(402).json({ error: `Limite atteinte (${limit} routeurs)` });
    return;
  }

  const [created] = await db
    .insert(routersTable)
    .values({
      ownerAdminId: adminId,
      name: name.trim(),
      hotspotName: hotspotName?.trim() || null,
      contact: contact?.trim() || null,
      host: host.trim(),
      port: port ?? 8728,
      username: username.trim(),
      password: password.trim(),
      isActive: isActive ?? true,
    })
    .returning();

  res.status(201).json(created);
});

export default router;
