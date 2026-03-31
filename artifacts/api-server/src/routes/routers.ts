import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, routersTable, vouchersTable } from "@workspace/db";
import { testConnection, listProfiles, listSessions, listHotspotUsers, disconnectSession, listLogs } from "../lib/mikrotik.js";

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

interface UserCache { users: Awaited<ReturnType<typeof listHotspotUsers>>; expiresAt: number; }
const userCache = new Map<number, UserCache>();
const USER_CACHE_TTL = 30_000;

async function getCachedUsers(id: number, conn: Parameters<typeof listHotspotUsers>[0]) {
  const cached = userCache.get(id);
  if (cached && Date.now() < cached.expiresAt) return cached.users;
  const users = await listHotspotUsers(conn, 60_000);
  userCache.set(id, { users, expiresAt: Date.now() + USER_CACHE_TTL });
  return users;
}

router.get("/routers/:id/users", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const { search, profile, limit: limitStr, offset: offsetStr } = req.query as {
    search?: string; profile?: string; limit?: string; offset?: string;
  };

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  try {
    const conn = { host: r.host, port: r.port, username: r.username, password: r.password };
    let users = await getCachedUsers(id, conn);

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

    const total = users.length;
    const limit = limitStr ? parseInt(limitStr, 10) : 100;
    const offset = offsetStr ? parseInt(offsetStr, 10) : 0;
    const paged = users.slice(offset, offset + limit);

    res.json({ users: paged, total });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de contacter le routeur" });
  }
});

router.get("/routers/:id/logs", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  try {
    const conn = { host: r.host, port: r.port, username: r.username, password: r.password };
    const topics = req.query.topics as string | undefined;
    const logs = await listLogs(conn, limit, topics);
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

export default router;
