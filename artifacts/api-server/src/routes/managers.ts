import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, managersTable, routersTable } from "@workspace/db";
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

/**
 * Returns the admin scope (adminId + isSuperAdmin + isImpersonating) when the
 * request carries a valid admin token, or null on unauthorized.
 * Supports super-admin impersonation via X-Impersonate-Admin header.
 */
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

/* ── GET /managers/me — gérant connecté lit ses propres infos ── */
router.get("/managers/me", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  const claims = auth?.startsWith("Bearer ") ? verifyToken(auth.slice(7)) : null;
  if (!claims) { res.status(401).json({ error: "Non authentifié" }); return; }
  const [mgr] = await db.select().from(managersTable).where(eq(managersTable.id, claims.managerId));
  if (!mgr) { res.status(404).json({ error: "Gérant introuvable" }); return; }
  res.json({ id: mgr.id, name: mgr.name, username: mgr.username });
});

router.get("/managers", async (req, res): Promise<void> => {
  const scope = getAdminScope(req, res);
  if (!scope) return;
  // Tenant filter: regular admin (or impersonating super-admin) sees only
  // their own managers; non-impersonating super admin sees everyone.
  const managers = (scope.isSuperAdmin && !scope.isImpersonating)
    ? await db.select().from(managersTable).orderBy(managersTable.name)
    : await db.select().from(managersTable)
        .where(eq(managersTable.ownerAdminId, scope.adminId))
        .orderBy(managersTable.name);
  res.json(managers.map(safeManager));
});

router.post("/managers", async (req, res): Promise<void> => {
  const scope = getAdminScope(req, res);
  if (!scope) return;
  const { name, username, password, routerId } = req.body as {
    name?: string; username?: string; password?: string; routerId?: number | null;
  };
  if (!name?.trim()) { res.status(400).json({ error: "Le nom est requis" }); return; }
  if (!username?.trim()) { res.status(400).json({ error: "Le nom d'utilisateur est requis" }); return; }
  if (!password || password.length < 1) {
    res.status(400).json({ error: "Mot de passe requis" }); return;
  }

  // If a routerId is supplied, make sure it belongs to the requester
  // (non-impersonating super admin bypasses this check).
  if (routerId != null && (!scope.isSuperAdmin || scope.isImpersonating)) {
    const [r] = await db.select({ owner: routersTable.ownerAdminId })
      .from(routersTable).where(eq(routersTable.id, routerId));
    if (!r) { res.status(400).json({ error: "Routeur invalide" }); return; }
    if (r.owner == null) {
      res.status(403).json({
        error:
          "Ce routeur n'est pas rattaché à un compte client. Contactez le super administrateur pour l'attribuer à votre espace.",
      });
      return;
    }
    if (r.owner !== scope.adminId) {
      res.status(403).json({ error: "Ce routeur ne vous appartient pas" });
      return;
    }
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
      routerId: routerId ?? null,
    })
    .returning();
  res.status(201).json(safeManager(manager));
});

/* ── PUT /managers/me/credentials — gérant change son login et/ou mot de passe ── */
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
  res.json(safeManager(updated));
});

/* ── PUT /managers/me/password — gérant change son propre mot de passe ── */
/* IMPORTANT: must be declared BEFORE /managers/:id to avoid route conflict  */
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

  // Tenant ownership check (non-impersonating super admin bypasses).
  const [target] = await db.select({ ownerAdminId: managersTable.ownerAdminId })
    .from(managersTable).where(eq(managersTable.id, id));
  if (!target) { res.status(404).json({ error: "Gérant introuvable" }); return; }
  if ((!scope.isSuperAdmin || scope.isImpersonating) && target.ownerAdminId !== scope.adminId) {
    res.status(403).json({ error: "Accès refusé" }); return;
  }

  const { name, username, password, isActive, routerId } = req.body as {
    name?: string; username?: string; password?: string; isActive?: boolean; routerId?: number | null;
  };

  if (username?.trim()) {
    const [existing] = await db.select({ id: managersTable.id })
      .from(managersTable).where(eq(managersTable.username, username.trim()));
    if (existing && existing.id !== id) {
      res.status(400).json({ error: "Ce nom d'utilisateur est déjà pris" }); return;
    }
  }

  // If a routerId is being assigned, verify it belongs to the caller's tenant.
  if (routerId !== undefined && routerId !== null) {
    const [r] = await db.select({ ownerAdminId: routersTable.ownerAdminId })
      .from(routersTable).where(eq(routersTable.id, routerId));
    if (!r) { res.status(400).json({ error: "Routeur introuvable" }); return; }
    if ((!scope.isSuperAdmin || scope.isImpersonating) && r.ownerAdminId !== scope.adminId) {
      res.status(403).json({ error: "Routeur d'un autre tenant" }); return;
    }
  }

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name.trim();
  if (username !== undefined) updates.username = username.trim();
  if (isActive !== undefined) updates.isActive = isActive;
  if ("routerId" in req.body) updates.routerId = routerId ?? null;
  if (password && password.trim()) {
    if (password.length < 1) { res.status(400).json({ error: "Mot de passe requis" }); return; }
    updates.passwordHash = await hashPassword(password);
    updates.passwordPlain = password;
  }

  const [manager] = await db.update(managersTable).set(updates)
    .where(eq(managersTable.id, id)).returning();
  if (!manager) { res.status(404).json({ error: "Gérant introuvable" }); return; }
  res.json(safeManager(manager));
});

router.delete("/managers/:id", async (req, res): Promise<void> => {
  const scope = getAdminScope(req, res);
  if (!scope) return;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  // Tenant ownership check (non-impersonating super admin bypasses).
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
