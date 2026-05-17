import { Router } from "express";
import { eq, and, inArray } from "drizzle-orm";
import { db, managersTable, managerRoutersTable, routersTable } from "@workspace/db";
import { hashPassword, verifyPassword, verifyToken } from "../lib/manager-auth.js";
import { verifyAdminToken, verifyAdminTokenFull } from "../lib/admin-auth.js";

const router = Router();

function requireAdmin(req: import("express").Request, res: import("express").Response): boolean {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ") || !verifyAdminToken(auth.slice(7))) {
    res.status(401).json({ error: "Accès réservé à l'administrateur" });
    return false;
  }
  return true;
}

function getAdminScope(req: import("express").Request, res: import("express").Response): { adminId: number; isSuperAdmin: boolean; isImpersonating?: boolean } | null {
  const auth = req.headers.authorization;
  const claims = auth?.startsWith("Bearer ") ? verifyAdminTokenFull(auth.slice(7)) : null;
  if (!claims) {
    res.status(401).json({ error: "Accès réservé à l'administrateur" });
    return null;
  }
  if (claims.isSuperAdmin) {
    const header = req.headers["x-impersonate-admin"];
    const targetId = typeof header === "string" ? parseInt(header, 10) : NaN;
    if (!isNaN(targetId) && targetId > 0 && targetId !== claims.adminId) {
      return { adminId: targetId, isSuperAdmin: true, isImpersonating: true };
    }
  }
  return claims;
}

function safeManager(m: typeof managersTable.$inferSelect) {
  const { passwordHash: _ph, ...rest } = m;
  return rest;
}

async function getRouterIds(managerId: number): Promise<number[]> {
  const rows = await db
    .select({ routerId: managerRoutersTable.routerId })
    .from(managerRoutersTable)
    .where(eq(managerRoutersTable.managerId, managerId));
  const ids = rows.map((r) => r.routerId);
  if (ids.length > 0) return ids;
  const [mgr] = await db
    .select({ routerId: managersTable.routerId })
    .from(managersTable)
    .where(eq(managersTable.id, managerId));
  return mgr?.routerId != null ? [mgr.routerId] : [];
}

async function assertRoutersOwnedByScope(
  scope: { adminId: number; isSuperAdmin: boolean; isImpersonating?: boolean },
  routerIds: number[],
): Promise<boolean> {
  if (scope.isSuperAdmin && !scope.isImpersonating) return true;
  const owned = await db
    .select({ id: routersTable.id })
    .from(routersTable)
    .where(and(inArray(routersTable.id, routerIds), eq(routersTable.ownerAdminId, scope.adminId)));
  return owned.length === routerIds.length;
}

async function syncManagerRouterAssignments(managerId: number, routerIds: number[]): Promise<void> {
  await db.delete(managerRoutersTable).where(eq(managerRoutersTable.managerId, managerId));
  if (routerIds.length > 0) {
    await db.insert(managerRoutersTable).values(
      routerIds.map((routerId) => ({ managerId, routerId })),
    );
    await db.update(managersTable).set({ routerId: routerIds[0] }).where(eq(managersTable.id, managerId));
  } else {
    await db.update(managersTable).set({ routerId: null }).where(eq(managersTable.id, managerId));
  }
}

function normalizeRouterIds(body: {
  routerIds?: unknown;
  routerId?: unknown;
}): number[] | undefined {
  if (Array.isArray(body.routerIds)) {
    return [...new Set(body.routerIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  }
  if (body.routerId !== undefined && body.routerId !== null) {
    const id = Number(body.routerId);
    return Number.isFinite(id) && id > 0 ? [id] : [];
  }
  if ("routerId" in body && body.routerId === null) return [];
  return undefined;
}

router.get("/managers/me", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  const claims = auth?.startsWith("Bearer ") ? verifyToken(auth.slice(7)) : null;
  if (!claims) { res.status(401).json({ error: "Non authentifié" }); return; }
  const [mgr] = await db.select().from(managersTable).where(eq(managersTable.id, claims.managerId));
  if (!mgr) { res.status(404).json({ error: "Gérant introuvable" }); return; }
  const routerIds = await getRouterIds(mgr.id);
  res.json({ id: mgr.id, name: mgr.name, username: mgr.username, routerIds });
});

router.get("/managers", async (req, res): Promise<void> => {
  const scope = getAdminScope(req, res);
  if (!scope) return;
  const managers = (scope.isSuperAdmin && !scope.isImpersonating)
    ? await db.select().from(managersTable).orderBy(managersTable.name)
    : await db.select().from(managersTable)
        .where(eq(managersTable.ownerAdminId, scope.adminId))
        .orderBy(managersTable.name);
  const ids = managers.map((m) => m.id);
  const assignments = ids.length === 0
    ? []
    : await db.select().from(managerRoutersTable).where(inArray(managerRoutersTable.managerId, ids));
  const result = managers.map((m) => {
    const fromJoin = assignments.filter((a) => a.managerId === m.id).map((a) => a.routerId);
    const routerIds = fromJoin.length > 0 ? fromJoin : (m.routerId != null ? [m.routerId] : []);
    return {
      ...safeManager(m),
      routerIds,
      routerId: routerIds[0] ?? null,
    };
  });
  res.json(result);
});

router.post("/managers", async (req, res): Promise<void> => {
  const scope = getAdminScope(req, res);
  if (!scope) return;
  const { name, username, password, routerIds: routerIdsRaw, routerId: routerIdRaw } = req.body as {
    name?: string;
    username?: string;
    password?: string;
    routerIds?: number[];
    routerId?: number | null;
  };
  const routerIds = normalizeRouterIds({ routerIds: routerIdsRaw, routerId: routerIdRaw }) ?? [];

  if (!name?.trim()) { res.status(400).json({ error: "Le nom est requis" }); return; }
  if (!username?.trim()) { res.status(400).json({ error: "Le nom d'utilisateur est requis" }); return; }
  if (!password || password.length < 1) {
    res.status(400).json({ error: "Mot de passe requis" }); return;
  }

  if (routerIds.length > 0 && !(await assertRoutersOwnedByScope(scope, routerIds))) {
    res.status(403).json({ error: "Certains routeurs ne vous appartiennent pas" });
    return;
  }

  const [existing] = await db.select({ id: managersTable.id })
    .from(managersTable).where(eq(managersTable.username, username.trim()));
  if (existing) { res.status(400).json({ error: "Ce nom d'utilisateur est déjà pris" }); return; }

  const passwordHash = await hashPassword(password);
  const [manager] = await db.insert(managersTable)
    .values({
      ownerAdminId: scope.adminId,
      name: name.trim(),
      username: username.trim(),
      passwordHash,
      passwordPlain: password,
      routerId: routerIds[0] ?? null,
    })
    .returning();

  if (routerIds.length > 0) {
    await db.insert(managerRoutersTable).values(
      routerIds.map((routerId) => ({ managerId: manager.id, routerId })),
    );
  }

  res.status(201).json({ ...safeManager(manager), routerIds, routerId: manager.routerId });
});

router.put("/managers/me/credentials", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) { res.status(401).json({ error: "Non authentifié" }); return; }
  const payload = verifyToken(auth.slice(7));
  if (!payload) { res.status(401).json({ error: "Token invalide ou expiré" }); return; }

  const { login, password } = req.body as { login?: string; password?: string };
  if (!login?.trim() && !password) {
    res.status(400).json({ error: "Aucune modification fournie" }); return;
  }

  const [manager] = await db.select().from(managersTable).where(eq(managersTable.id, payload.managerId));
  if (!manager) { res.status(404).json({ error: "Gérant introuvable" }); return; }

  const updates: Record<string, unknown> = {};

  if (login?.trim()) {
    const loginTrimmed = login.trim();
    if (loginTrimmed.length < 1) { res.status(400).json({ error: "Login requis" }); return; }
    const [existing] = await db.select({ id: managersTable.id }).from(managersTable).where(eq(managersTable.username, loginTrimmed));
    if (existing && existing.id !== manager.id) {
      res.status(409).json({ error: "Ce login est déjà utilisé" }); return;
    }
    updates.username = loginTrimmed;
  }

  if (password) {
    if (password.length < 1) { res.status(400).json({ error: "Mot de passe requis" }); return; }
    updates.passwordHash = await hashPassword(password);
    updates.passwordPlain = password;
  }

  const [updated] = await db.update(managersTable).set(updates).where(eq(managersTable.id, manager.id)).returning();
  res.json({ ...safeManager(updated), routerIds: await getRouterIds(manager.id) });
});

router.put("/managers/me/password", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) { res.status(401).json({ error: "Non authentifié" }); return; }
  const payload = verifyToken(auth.slice(7));
  if (!payload) { res.status(401).json({ error: "Token invalide ou expiré" }); return; }

  const { newPassword } = req.body as { newPassword?: string };
  if (!newPassword) {
    res.status(400).json({ error: "Champs requis manquants" }); return;
  }
  if (newPassword.length < 1) {
    res.status(400).json({ error: "Le nouveau mot de passe est requis" }); return;
  }

  const [manager] = await db.select().from(managersTable).where(eq(managersTable.id, payload.managerId));
  if (!manager) { res.status(404).json({ error: "Gérant introuvable" }); return; }

  const passwordHash = await hashPassword(newPassword);
  await db.update(managersTable).set({ passwordHash, passwordPlain: newPassword }).where(eq(managersTable.id, manager.id));

  res.json({ success: true });
});

router.put("/managers/:id", async (req, res): Promise<void> => {
  const scope = getAdminScope(req, res);
  if (!scope) return;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [target] = await db.select({ ownerAdminId: managersTable.ownerAdminId })
    .from(managersTable).where(eq(managersTable.id, id));
  if (!target) { res.status(404).json({ error: "Gérant introuvable" }); return; }
  if ((!scope.isSuperAdmin || scope.isImpersonating) && target.ownerAdminId !== scope.adminId) {
    res.status(403).json({ error: "Accès refusé" }); return;
  }

  const { name, username, password, isActive, routerIds: routerIdsRaw, routerId: routerIdRaw } = req.body as {
    name?: string;
    username?: string;
    password?: string;
    isActive?: boolean;
    routerIds?: number[];
    routerId?: number | null;
  };

  const routerIdsNorm = normalizeRouterIds({ routerIds: routerIdsRaw, routerId: routerIdRaw });

  if (username?.trim()) {
    const [existing] = await db.select({ id: managersTable.id })
      .from(managersTable).where(eq(managersTable.username, username.trim()));
    if (existing && existing.id !== id) {
      res.status(400).json({ error: "Ce nom d'utilisateur est déjà pris" }); return;
    }
  }

  if (routerIdsNorm !== undefined && routerIdsNorm.length > 0 && !(await assertRoutersOwnedByScope(scope, routerIdsNorm))) {
    res.status(403).json({ error: "Un ou plusieurs routeurs n'appartiennent pas à votre tenant" });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name.trim();
  if (username !== undefined) updates.username = username.trim();
  if (isActive !== undefined) updates.isActive = isActive;
  if (password && password.trim()) {
    if (password.length < 1) { res.status(400).json({ error: "Mot de passe requis" }); return; }
    updates.passwordHash = await hashPassword(password);
    updates.passwordPlain = password;
  }

  const [manager] = await db.update(managersTable).set(updates)
    .where(eq(managersTable.id, id)).returning();
  if (!manager) { res.status(404).json({ error: "Gérant introuvable" }); return; }

  if (routerIdsNorm !== undefined) {
    await syncManagerRouterAssignments(id, routerIdsNorm);
  }

  const finalRouterIds = await getRouterIds(id);
  res.json({ ...safeManager(manager), routerIds: finalRouterIds, routerId: finalRouterIds[0] ?? null });
});

router.delete("/managers/:id", async (req, res): Promise<void> => {
  const scope = getAdminScope(req, res);
  if (!scope) return;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [target] = await db.select({ ownerAdminId: managersTable.ownerAdminId })
    .from(managersTable).where(eq(managersTable.id, id));
  if (!target) { res.status(404).json({ error: "Gérant introuvable" }); return; }
  if ((!scope.isSuperAdmin || scope.isImpersonating) && target.ownerAdminId !== scope.adminId) {
    res.status(403).json({ error: "Accès refusé" }); return;
  }

  const [deleted] = await db.delete(managersTable).where(eq(managersTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Gérant introuvable" }); return; }
  res.sendStatus(204);
});

export default router;
