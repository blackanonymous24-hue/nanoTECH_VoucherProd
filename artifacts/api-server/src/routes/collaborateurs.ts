import { Router } from "express";
import { eq, and, inArray } from "drizzle-orm";
import { db, collaborateursTable, collaborateurRoutersTable, routersTable } from "@workspace/db";
import { hashPassword, verifyPassword, verifyToken } from "../lib/collaborateur-auth.js";
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

/**
 * Returns the admin scope (adminId + isSuperAdmin) when the request carries
 * a valid admin token, or null on unauthorized.
 */
function getAdminScope(req: import("express").Request, res: import("express").Response): { adminId: number; isSuperAdmin: boolean } | null {
  const auth = req.headers.authorization;
  const claims = auth?.startsWith("Bearer ") ? verifyAdminTokenFull(auth.slice(7)) : null;
  if (!claims) {
    res.status(401).json({ error: "Accès réservé à l'administrateur" });
    return null;
  }
  return claims;
}

function safeCollab(c: typeof collaborateursTable.$inferSelect) {
  const { passwordHash: _ph, ...rest } = c;
  return rest;
}

async function getRouterIds(collaborateurId: number): Promise<number[]> {
  const rows = await db
    .select({ routerId: collaborateurRoutersTable.routerId })
    .from(collaborateurRoutersTable)
    .where(eq(collaborateurRoutersTable.collaborateurId, collaborateurId));
  return rows.map((r) => r.routerId);
}

/* ── GET /collaborateurs/me — collaborateur connecté lit ses propres infos ── */
router.get("/collaborateurs/me", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  const claims = auth?.startsWith("Bearer ") ? verifyToken(auth.slice(7)) : null;
  if (!claims) { res.status(401).json({ error: "Non authentifié" }); return; }
  const [collab] = await db.select().from(collaborateursTable).where(eq(collaborateursTable.id, claims.collaborateurId));
  if (!collab) { res.status(404).json({ error: "Collaborateur introuvable" }); return; }
  res.json({ id: collab.id, name: collab.name, username: collab.username });
});

router.get("/collaborateurs", async (req, res): Promise<void> => {
  const scope = getAdminScope(req, res);
  if (!scope) return;
  // Tenant filter: regular admin only sees their own collaborateurs.
  const collabs = scope.isSuperAdmin
    ? await db.select().from(collaborateursTable).orderBy(collaborateursTable.name)
    : await db.select().from(collaborateursTable)
        .where(eq(collaborateursTable.ownerAdminId, scope.adminId))
        .orderBy(collaborateursTable.name);
  // Only fetch assignments belonging to the visible collaborateurs to avoid
  // leaking another admin's router_ids when filtered.
  const ids = collabs.map((c) => c.id);
  const assignments = ids.length === 0
    ? []
    : await db.select().from(collaborateurRoutersTable)
        .where(inArray(collaborateurRoutersTable.collaborateurId, ids));
  const result = collabs.map((c) => ({
    ...safeCollab(c),
    routerIds: assignments.filter((a) => a.collaborateurId === c.id).map((a) => a.routerId),
  }));
  res.json(result);
});

router.post("/collaborateurs", async (req, res): Promise<void> => {
  const scope = getAdminScope(req, res);
  if (!scope) return;
  const { name, username, password, routerIds } = req.body as {
    name?: string; username?: string; password?: string; routerIds?: number[];
  };
  if (!name?.trim()) { res.status(400).json({ error: "Le nom est requis" }); return; }
  if (!username?.trim()) { res.status(400).json({ error: "Le nom d'utilisateur est requis" }); return; }
  if (!password || password.length < 4) {
    res.status(400).json({ error: "Mot de passe requis (4 caractères minimum)" }); return;
  }
  if (!Array.isArray(routerIds) || routerIds.length === 0) {
    res.status(400).json({ error: "Au moins un routeur doit être assigné" }); return;
  }

  // Verify all assigned routers belong to this admin (super admin bypasses).
  if (!scope.isSuperAdmin) {
    const owned = await db.select({ id: routersTable.id })
      .from(routersTable)
      .where(and(
        inArray(routersTable.id, routerIds),
        eq(routersTable.ownerAdminId, scope.adminId),
      ));
    if (owned.length !== routerIds.length) {
      res.status(403).json({ error: "Certains routeurs ne vous appartiennent pas" });
      return;
    }
  }

  const [existing] = await db.select({ id: collaborateursTable.id })
    .from(collaborateursTable).where(eq(collaborateursTable.username, username.trim()));
  if (existing) { res.status(400).json({ error: "Ce nom d'utilisateur est déjà pris" }); return; }

  const passwordHash = await hashPassword(password);
  const [collab] = await db.insert(collaborateursTable)
    .values({
      ownerAdminId: scope.adminId,
      name: name.trim(),
      username: username.trim(),
      passwordHash,
      passwordPlain: password,
    })
    .returning();

  await db.insert(collaborateurRoutersTable).values(
    routerIds.map((rid) => ({ collaborateurId: collab.id, routerId: rid }))
  );

  res.status(201).json({ ...safeCollab(collab), routerIds });
});

/* ── PUT /collaborateurs/me/credentials — collaborateur change login et/ou mot de passe ── */
router.put("/collaborateurs/me/credentials", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) { res.status(401).json({ error: "Non authentifié" }); return; }
  const payload = verifyToken(auth.slice(7));
  if (!payload) { res.status(401).json({ error: "Token invalide ou expiré" }); return; }

  const { login, password } = req.body as { login?: string; password?: string };
  if (!login?.trim() && !password) {
    res.status(400).json({ error: "Aucune modification fournie" }); return;
  }

  const [collab] = await db.select().from(collaborateursTable).where(eq(collaborateursTable.id, payload.collaborateurId));
  if (!collab) { res.status(404).json({ error: "Collaborateur introuvable" }); return; }

  const updates: Record<string, unknown> = {};

  if (login?.trim()) {
    const loginTrimmed = login.trim();
    if (loginTrimmed.length < 3) { res.status(400).json({ error: "Login trop court (min 3 caractères)" }); return; }
    const [existing] = await db.select({ id: collaborateursTable.id }).from(collaborateursTable).where(eq(collaborateursTable.username, loginTrimmed));
    if (existing && existing.id !== collab.id) {
      res.status(409).json({ error: "Ce login est déjà utilisé" }); return;
    }
    updates.username = loginTrimmed;
  }

  if (password) {
    if (password.length < 4) { res.status(400).json({ error: "Mot de passe trop court (min 4 caractères)" }); return; }
    updates.passwordHash = await hashPassword(password);
    updates.passwordPlain = password;
  }

  const [updated] = await db.update(collaborateursTable).set(updates).where(eq(collaborateursTable.id, collab.id)).returning();
  res.json(safeCollab(updated));
});

router.put("/collaborateurs/me/password", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) { res.status(401).json({ error: "Non authentifié" }); return; }
  const payload = verifyToken(auth.slice(7));
  if (!payload) { res.status(401).json({ error: "Token invalide ou expiré" }); return; }

  const { newPassword } = req.body as { newPassword?: string };
  if (!newPassword) {
    res.status(400).json({ error: "Champs requis manquants" }); return;
  }
  if (newPassword.length < 4) {
    res.status(400).json({ error: "Le nouveau mot de passe doit comporter au moins 4 caractères" }); return;
  }

  const [collab] = await db.select().from(collaborateursTable).where(eq(collaborateursTable.id, payload.collaborateurId));
  if (!collab) { res.status(404).json({ error: "Collaborateur introuvable" }); return; }

  const passwordHash = await hashPassword(newPassword);
  await db.update(collaborateursTable).set({ passwordHash, passwordPlain: newPassword }).where(eq(collaborateursTable.id, collab.id));
  res.json({ success: true });
});

router.put("/collaborateurs/:id", async (req, res): Promise<void> => {
  const scope = getAdminScope(req, res);
  if (!scope) return;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  // Tenant ownership check (regular admins only — super sees all).
  const [target] = await db.select({ ownerAdminId: collaborateursTable.ownerAdminId })
    .from(collaborateursTable).where(eq(collaborateursTable.id, id));
  if (!target) { res.status(404).json({ error: "Collaborateur introuvable" }); return; }
  if (!scope.isSuperAdmin && target.ownerAdminId !== scope.adminId) {
    res.status(403).json({ error: "Accès refusé" }); return;
  }

  const { name, username, password, isActive, routerIds } = req.body as {
    name?: string; username?: string; password?: string; isActive?: boolean; routerIds?: number[];
  };

  if (username?.trim()) {
    const [existing] = await db.select({ id: collaborateursTable.id })
      .from(collaborateursTable).where(eq(collaborateursTable.username, username.trim()));
    if (existing && existing.id !== id) {
      res.status(400).json({ error: "Ce nom d'utilisateur est déjà pris" }); return;
    }
  }

  if (Array.isArray(routerIds) && routerIds.length === 0) {
    res.status(400).json({ error: "Au moins un routeur doit être assigné" }); return;
  }

  // If routerIds are provided, verify each belongs to the caller's tenant.
  if (Array.isArray(routerIds) && routerIds.length > 0 && !scope.isSuperAdmin) {
    const owned = await db.select({ id: routersTable.id })
      .from(routersTable)
      .where(and(
        inArray(routersTable.id, routerIds),
        eq(routersTable.ownerAdminId, scope.adminId),
      ));
    if (owned.length !== routerIds.length) {
      res.status(403).json({ error: "Un ou plusieurs routeurs n'appartiennent pas à votre tenant" }); return;
    }
  }

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name.trim();
  if (username !== undefined) updates.username = username.trim();
  if (isActive !== undefined) updates.isActive = isActive;
  if (password && password.trim()) {
    if (password.length < 4) { res.status(400).json({ error: "Mot de passe trop court (4 car. minimum)" }); return; }
    updates.passwordHash = await hashPassword(password);
    updates.passwordPlain = password;
  }

  const [collab] = await db.update(collaborateursTable).set(updates)
    .where(eq(collaborateursTable.id, id)).returning();
  if (!collab) { res.status(404).json({ error: "Collaborateur introuvable" }); return; }

  if (Array.isArray(routerIds) && routerIds.length > 0) {
    await db.delete(collaborateurRoutersTable).where(eq(collaborateurRoutersTable.collaborateurId, id));
    await db.insert(collaborateurRoutersTable).values(
      routerIds.map((rid) => ({ collaborateurId: id, routerId: rid }))
    );
  }

  const finalRouterIds = await getRouterIds(id);
  res.json({ ...safeCollab(collab), routerIds: finalRouterIds });
});

router.delete("/collaborateurs/:id", async (req, res): Promise<void> => {
  const scope = getAdminScope(req, res);
  if (!scope) return;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  // Tenant ownership check (regular admins only — super sees all).
  const [target] = await db.select({ ownerAdminId: collaborateursTable.ownerAdminId })
    .from(collaborateursTable).where(eq(collaborateursTable.id, id));
  if (!target) { res.status(404).json({ error: "Collaborateur introuvable" }); return; }
  if (!scope.isSuperAdmin && target.ownerAdminId !== scope.adminId) {
    res.status(403).json({ error: "Accès refusé" }); return;
  }

  const [deleted] = await db.delete(collaborateursTable).where(eq(collaborateursTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Collaborateur introuvable" }); return; }
  res.sendStatus(204);
});

export default router;
