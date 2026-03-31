import { Router } from "express";
import { eq, and, isNotNull, isNull, inArray, sql } from "drizzle-orm";
import { db, routersTable, vouchersTable } from "@workspace/db";
import { testConnection, pingRouter, getRouterInfo, listProfiles, createProfile, updateProfile, deleteProfile, listAddressPools, listSessions, listHotspotUsers, disconnectSession, listLogs, fetchSalesFromScripts, fetchUsedUsernames, type SalesReport } from "../lib/mikrotik.js";

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

router.get("/routers/:id/ping", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  const online = await pingRouter({ host: r.host, port: r.port, username: r.username, password: r.password });
  res.json({ success: online });
});

router.get("/routers/:id/info", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  try {
    const info = await getRouterInfo({ host: r.host, port: r.port, username: r.username, password: r.password });
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

  try {
    const profiles = await listProfiles({ host: r.host, port: r.port, username: r.username, password: r.password });
    res.json(profiles);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de contacter le routeur" });
  }
});

router.post("/routers/:id/profiles", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  const { name, validity, price, sellingPrice, sharedUsers, addrPool, rateLimit, expiredMode, lockMac, parentQueue } = req.body as {
    name?: string; validity?: string; price?: string; sellingPrice?: string;
    sharedUsers?: string; addrPool?: string; rateLimit?: string;
    expiredMode?: string; lockMac?: boolean; parentQueue?: string;
  };
  if (!name || !price || !validity) {
    res.status(400).json({ error: "Champs obligatoires manquants : name, price, validity" }); return;
  }

  try {
    await createProfile(
      { host: r.host, port: r.port, username: r.username, password: r.password },
      {
        name: name.trim(),
        validity: validity.trim(),
        price: price.trim(),
        sellingPrice: (sellingPrice ?? "").trim(),
        sharedUsers: (sharedUsers ?? "1").trim(),
        addrPool: (addrPool ?? "").trim(),
        rateLimit: (rateLimit ?? "").trim(),
        expiredMode: (expiredMode ?? "None").trim(),
        lockMac: lockMac === true,
        parentQueue: (parentQueue ?? "").trim(),
      },
    );
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

  const { name, validity, price, sellingPrice, sharedUsers, addrPool, rateLimit, expiredMode, lockMac, parentQueue } = req.body as {
    name?: string; validity?: string; price?: string; sellingPrice?: string;
    sharedUsers?: string; addrPool?: string; rateLimit?: string;
    expiredMode?: string; lockMac?: boolean; parentQueue?: string;
  };
  if (!name || !price || !validity) {
    res.status(400).json({ error: "Champs obligatoires manquants : name, price, validity" }); return;
  }

  try {
    await updateProfile(
      { host: r.host, port: r.port, username: r.username, password: r.password },
      originalName,
      {
        name: name.trim(),
        validity: validity.trim(),
        price: price.trim(),
        sellingPrice: (sellingPrice ?? "").trim(),
        sharedUsers: (sharedUsers ?? "1").trim(),
        addrPool: (addrPool ?? "").trim(),
        rateLimit: (rateLimit ?? "").trim(),
        expiredMode: (expiredMode ?? "None").trim(),
        lockMac: lockMac === true,
        parentQueue: (parentQueue ?? "").trim(),
      },
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de modifier le profil" });
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

  try {
    const pools = await listAddressPools({ host: r.host, port: r.port, username: r.username, password: r.password });
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

// ─── Sales cache ─────────────────────────────────────────────────────────────
interface SalesCacheEntry { data: SalesReport; updatedAt: number; }
const salesCache = new Map<number, SalesCacheEntry>();
const salesRefreshing = new Set<number>();
const SALES_TTL = 5 * 60 * 1000; // 5 minutes

async function triggerSalesRefresh(id: number, host: string, port: number, username: string, password: string) {
  if (salesRefreshing.has(id)) return;
  salesRefreshing.add(id);
  try {
    const conn = { host, port, username, password };
    // Use 90s timeout — background, not constrained by Replit proxy
    const data = await fetchSalesFromScripts(conn, 90_000);
    salesCache.set(id, { data, updatedAt: Date.now() });
  } catch { /* keep stale cache on error */ } finally {
    salesRefreshing.delete(id);
  }
}

router.get("/routers/:id/sales", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
  if (!r) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  const cached = salesCache.get(id);
  const now = Date.now();

  // Trigger background refresh if cache is absent, stale (> TTL), or aging (> 2min)
  const needsRefresh = !cached || (now - cached.updatedAt) > SALES_TTL;
  const agingRefresh = cached && (now - cached.updatedAt) > 2 * 60 * 1000;
  if (needsRefresh || agingRefresh) {
    triggerSalesRefresh(id, r.host, r.port, r.username, r.password);
  }

  if (cached) {
    res.json({ ...cached.data, _cachedAt: cached.updatedAt });
  } else {
    // No cache yet — return zeros, data will arrive on next poll
    const mm = String(new Date().getMonth() + 1).padStart(2, "0");
    const y  = new Date().getFullYear();
    const d  = String(new Date().getDate()).padStart(2, "0");
    res.json({
      dailyCount: 0, dailyAmount: 0, monthlyCount: 0, monthlyAmount: 0,
      dateLabel: `${y}-${mm}-${d}`, monthLabel: `${mm}${y}`, _cachedAt: null,
    });
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

/**
 * POST /routers/:id/sync-usage
 * Fetches used usernames from MikroTik (hotspot logs + MikHmon scripts)
 * and marks matching vouchers in the DB with usedAt if not already set.
 */
router.post("/routers/:id/sync-usage", async (req, res): Promise<void> => {
  const routerId = parseInt(req.params.id, 10);
  if (isNaN(routerId)) { res.status(400).json({ error: "ID invalide" }); return; }

  const [routerRow] = await db
    .select()
    .from(routersTable)
    .where(eq(routersTable.id, routerId));

  if (!routerRow) { res.status(404).json({ error: "Routeur introuvable" }); return; }

  const conn = {
    host: routerRow.host,
    port: routerRow.port,
    username: routerRow.username,
    password: routerRow.password,
  };

  try {
    const usedUsernames = await fetchUsedUsernames(conn);

    if (usedUsernames.size === 0) {
      res.json({ updated: 0, total: 0, message: "Aucun utilisateur trouvé dans les logs/scripts" });
      return;
    }

    // Get all vouchers for this router assigned to a vendor, not yet marked as used
    const vouchers = await db
      .select({ id: vouchersTable.id, username: vouchersTable.username, printedAt: vouchersTable.printedAt })
      .from(vouchersTable)
      .where(and(
        eq(vouchersTable.routerId, routerId),
        isNotNull(vouchersTable.vendorId),
        isNull(vouchersTable.usedAt),
      ));

    const toUpdate = vouchers
      .filter((v) => usedUsernames.has(v.username.toLowerCase()))
      .map((v) => v.id);

    let updated = 0;
    if (toUpdate.length > 0) {
      const now = new Date();
      // Mark usedAt; also backfill printedAt if it was never set
      // (voucher was sold outside VoucherNet's print flow)
      await db
        .update(vouchersTable)
        .set({ usedAt: now, printedAt: sql`coalesce(${vouchersTable.printedAt}, ${now.toISOString()})` })
        .where(inArray(vouchersTable.id, toUpdate));
      updated = toUpdate.length;
    }

    res.json({
      updated,
      total: vouchers.length,
      usedOnRouter: usedUsernames.size,
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Impossible de contacter le routeur" });
  }
});

export default router;
