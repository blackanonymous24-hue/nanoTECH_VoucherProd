import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, collaborateursTable, collaborateurRoutersTable } from "@workspace/db";
import { hashPassword, verifyPassword, verifyToken } from "../lib/collaborateur-auth.js";
import { verifyAdminToken } from "../lib/admin-auth.js";

const router = Router();

function requireAdmin(req: import("express").Request, res: import("express").Response): boolean {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ") || !verifyAdminToken(auth.slice(7))) {
    res.status(401).json({ error: "Accès réservé à l'administrateur" });
    return false;
  }
  return true;
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

router.get("/collaborateurs", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const collabs = await db.select().from(collaborateursTable).orderBy(collaborateursTable.name);
  const assignments = await db.select().from(collaborateurRoutersTable);
  const result = collabs.map((c) => ({
    ...safeCollab(c),
    routerIds: assignments.filter((a) => a.collaborateurId === c.id).map((a) => a.routerId),
  }));
  res.json(result);
});

router.post("/collaborateurs", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
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

  const [existing] = await db.select({ id: collaborateursTable.id })
    .from(collaborateursTable).where(eq(collaborateursTable.username, username.trim()));
  if (existing) { res.status(400).json({ error: "Ce nom d'utilisateur est déjà pris" }); return; }

  const passwordHash = await hashPassword(password);
  const [collab] = await db.insert(collaborateursTable)
    .values({ name: name.trim(), username: username.trim(), passwordHash })
    .returning();

  await db.insert(collaborateurRoutersTable).values(
    routerIds.map((rid) => ({ collaborateurId: collab.id, routerId: rid }))
  );

  res.status(201).json({ ...safeCollab(collab), routerIds });
});

router.put("/collaborateurs/me/password", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) { res.status(401).json({ error: "Non authentifié" }); return; }
  const payload = verifyToken(auth.slice(7));
  if (!payload) { res.status(401).json({ error: "Token invalide ou expiré" }); return; }

  const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "Champs requis manquants" }); return;
  }
  if (newPassword.length < 4) {
    res.status(400).json({ error: "Le nouveau mot de passe doit comporter au moins 4 caractères" }); return;
  }

  const [collab] = await db.select().from(collaborateursTable).where(eq(collaborateursTable.id, payload.collaborateurId));
  if (!collab || !collab.passwordHash) { res.status(404).json({ error: "Collaborateur introuvable" }); return; }

  const valid = await verifyPassword(currentPassword, collab.passwordHash);
  if (!valid) { res.status(401).json({ error: "Ancien mot de passe incorrect" }); return; }

  const passwordHash = await hashPassword(newPassword);
  await db.update(collaborateursTable).set({ passwordHash }).where(eq(collaborateursTable.id, collab.id));
  res.json({ success: true });
});

router.put("/collaborateurs/:id", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

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

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name.trim();
  if (username !== undefined) updates.username = username.trim();
  if (isActive !== undefined) updates.isActive = isActive;
  if (password && password.trim()) {
    if (password.length < 4) { res.status(400).json({ error: "Mot de passe trop court (4 car. minimum)" }); return; }
    updates.passwordHash = await hashPassword(password);
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
  if (!requireAdmin(req, res)) return;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [deleted] = await db.delete(collaborateursTable).where(eq(collaborateursTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Collaborateur introuvable" }); return; }
  res.sendStatus(204);
});

export default router;
