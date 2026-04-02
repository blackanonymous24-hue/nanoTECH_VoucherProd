import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, managersTable } from "@workspace/db";
import { hashPassword } from "../lib/manager-auth.js";
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

function safeManager(m: typeof managersTable.$inferSelect) {
  const { passwordHash: _ph, ...rest } = m;
  return rest;
}

router.get("/managers", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const managers = await db.select().from(managersTable).orderBy(managersTable.name);
  res.json(managers.map(safeManager));
});

router.post("/managers", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const { name, username, password } = req.body as {
    name?: string; username?: string; password?: string;
  };
  if (!name?.trim()) { res.status(400).json({ error: "Le nom est requis" }); return; }
  if (!username?.trim()) { res.status(400).json({ error: "Le nom d'utilisateur est requis" }); return; }
  if (!password || password.length < 4) {
    res.status(400).json({ error: "Mot de passe requis (4 caractères minimum)" }); return;
  }
  const [existing] = await db.select({ id: managersTable.id })
    .from(managersTable).where(eq(managersTable.username, username.trim()));
  if (existing) { res.status(400).json({ error: "Ce nom d'utilisateur est déjà pris" }); return; }

  const passwordHash = await hashPassword(password);
  const [manager] = await db.insert(managersTable)
    .values({ name: name.trim(), username: username.trim(), passwordHash })
    .returning();
  res.status(201).json(safeManager(manager));
});

router.put("/managers/:id", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const { name, username, password, isActive } = req.body as {
    name?: string; username?: string; password?: string; isActive?: boolean;
  };

  if (username?.trim()) {
    const [existing] = await db.select({ id: managersTable.id })
      .from(managersTable).where(eq(managersTable.username, username.trim()));
    if (existing && existing.id !== id) {
      res.status(400).json({ error: "Ce nom d'utilisateur est déjà pris" }); return;
    }
  }

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name.trim();
  if (username !== undefined) updates.username = username.trim();
  if (isActive !== undefined) updates.isActive = isActive;
  if (password && password.trim()) {
    if (password.length < 4) { res.status(400).json({ error: "Mot de passe trop court (4 car. minimum)" }); return; }
    updates.passwordHash = await hashPassword(password);
  }

  const [manager] = await db.update(managersTable).set(updates)
    .where(eq(managersTable.id, id)).returning();
  if (!manager) { res.status(404).json({ error: "Gérant introuvable" }); return; }
  res.json(safeManager(manager));
});

router.delete("/managers/:id", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [deleted] = await db.delete(managersTable).where(eq(managersTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Gérant introuvable" }); return; }
  res.sendStatus(204);
});

export default router;
