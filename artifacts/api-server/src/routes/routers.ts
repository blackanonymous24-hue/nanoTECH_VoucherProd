import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, routersTable } from "@workspace/db";
import { testConnection, listProfiles, listSessions } from "../lib/mikrotik.js";

const router = Router();

router.get("/routers", async (_req, res): Promise<void> => {
  const routers = await db
    .select({
      id: routersTable.id,
      name: routersTable.name,
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
  const { name, host, port, username, password, isActive } = req.body as {
    name?: string;
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
      host,
      port: port ?? 8728,
      username,
      password,
      isActive: isActive ?? true,
    })
    .returning({
      id: routersTable.id,
      name: routersTable.name,
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

  const { name, host, port, username, password, isActive } = req.body as {
    name?: string;
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    isActive?: boolean;
  };

  const updates: Partial<typeof routersTable.$inferInsert> = {};
  if (name !== undefined) updates.name = name;
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

router.get("/routers/:id/profiles", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  try {
    const profiles = await listProfiles({ host: r.host, port: r.port, username: r.username, password: r.password });
    res.json(profiles);
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

  try {
    const sessions = await listSessions({ host: r.host, port: r.port, username: r.username, password: r.password });
    res.json(sessions);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de contacter le routeur" });
  }
});

export default router;
