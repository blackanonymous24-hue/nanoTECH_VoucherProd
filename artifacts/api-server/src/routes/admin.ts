import { Router } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db, adminSettingsTable, vendorsTable, managersTable, routersTable, collaborateursTable, collaborateurRoutersTable, scriptSalesTable } from "@workspace/db";
import { hashPassword, verifyPassword, createAdminToken, verifyAdminToken } from "../lib/admin-auth.js";
import { verifyPassword as verifyVendorPassword, createToken as createVendorToken } from "../lib/vendor-auth.js";
import { verifyPassword as verifyManagerPassword, createToken as createManagerToken } from "../lib/manager-auth.js";
import { verifyPassword as verifyCollabPassword, createToken as createCollabToken } from "../lib/collaborateur-auth.js";
import { purgePhantomVouchers, forceRouterFullSync } from "../lib/vendor-sync.js";
import { purgeOldMikhmonScripts } from "../lib/mikrotik.js";
import { withRouterLock } from "../lib/router-lock.js";
import { clearRouterScriptCache } from "../lib/script-cache.js";

const router = Router();

async function getOrInitAdmin(): Promise<{ id: number; login: string; passwordHash: string }> {
  const rows = await db.select().from(adminSettingsTable).limit(1);
  if (rows.length > 0) return rows[0];
  const passwordHash = await hashPassword("root");
  const [created] = await db
    .insert(adminSettingsTable)
    .values({ login: "admin", passwordHash })
    .returning();
  return created;
}

router.post("/login", async (req, res): Promise<void> => {
  const { login, password } = req.body as { login?: string; password?: string };
  if (!login || !password) {
    res.status(400).json({ error: "Identifiants requis" });
    return;
  }
  const loginTrimmed = login.trim();

  const admin = await getOrInitAdmin();
  if (loginTrimmed === admin.login) {
    const valid = await verifyPassword(password, admin.passwordHash);
    if (valid) {
      res.json({ role: "admin", token: createAdminToken() });
      return;
    }
  }

  const [manager] = await db
    .select()
    .from(managersTable)
    .where(eq(managersTable.username, loginTrimmed));

  if (manager?.passwordHash && manager.isActive) {
    const valid = await verifyManagerPassword(password, manager.passwordHash);
    if (valid) {
      res.json({
        role: "manager",
        token: createManagerToken(manager.id),
        manager: { id: manager.id, name: manager.name, username: manager.username, routerId: manager.routerId ?? null },
      });
      return;
    }
  }

  const [vendor] = await db
    .select()
    .from(vendorsTable)
    .where(eq(vendorsTable.username, loginTrimmed));

  if (vendor?.passwordHash && vendor.isActive) {
    const valid = await verifyVendorPassword(password, vendor.passwordHash);
    if (valid) {
      res.json({
        role: "vendor",
        token: createVendorToken(vendor.id),
        vendor: { id: vendor.id, name: vendor.name, email: vendor.email, username: vendor.username },
      });
      return;
    }
  }

  const [collab] = await db
    .select()
    .from(collaborateursTable)
    .where(eq(collaborateursTable.username, loginTrimmed));

  if (collab?.passwordHash && collab.isActive) {
    const valid = await verifyCollabPassword(password, collab.passwordHash);
    if (valid) {
      const routerRows = await db
        .select({ routerId: collaborateurRoutersTable.routerId })
        .from(collaborateurRoutersTable)
        .where(eq(collaborateurRoutersTable.collaborateurId, collab.id));
      const routerIds = routerRows.map((r) => r.routerId);
      res.json({
        role: "collaborateur",
        token: createCollabToken(collab.id, routerIds),
        collaborateur: { id: collab.id, name: collab.name, username: collab.username, routerIds },
      });
      return;
    }
  }

  res.status(401).json({ error: "Identifiants incorrects" });
});

router.get("/admin/me", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ") || !verifyAdminToken(auth.slice(7))) {
    res.status(401).json({ error: "Non authentifié" });
    return;
  }
  const admin = await getOrInitAdmin();
  res.json({ login: admin.login });
});

router.put("/admin/credentials", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ") || !verifyAdminToken(auth.slice(7))) {
    res.status(401).json({ error: "Non authentifié" });
    return;
  }
  const { login, password } = req.body as { login?: string; password?: string };
  if (!login || !password) {
    res.status(400).json({ error: "Identifiants requis" });
    return;
  }
  const passwordHash = await hashPassword(password);
  const admin = await getOrInitAdmin();
  await db
    .update(adminSettingsTable)
    .set({ login: login.trim(), passwordHash })
    .where(eq(adminSettingsTable.id, admin.id));
  res.json({ ok: true });
});

router.post("/admin/purge-phantoms", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ") || !verifyAdminToken(auth.slice(7))) {
    res.status(401).json({ error: "Non authentifié" });
    return;
  }

  const { routerId } = req.body as { routerId?: number };

  const routers = routerId
    ? await db.select({ id: routersTable.id, host: routersTable.host, name: routersTable.name }).from(routersTable).where(eq(routersTable.id, routerId))
    : await db.select({ id: routersTable.id, host: routersTable.host, name: routersTable.name }).from(routersTable);

  const results: Array<Awaited<ReturnType<typeof purgePhantomVouchers>> & { routerName: string }> = [];
  for (const r of routers) {
    const result = await purgePhantomVouchers(r.id);
    results.push({ ...result, routerName: r.name ?? r.host });
  }

  const totalDeleted = results.reduce((sum, r) => sum + r.deleted, 0);
  res.json({ results, totalDeleted });
});

/**
 * POST /api/admin/routers/:routerId/force-sync
 * Forces a complete script-cache reload + historical backfill for a specific router.
 * Used to recover missed vouchers caused by router timeouts.
 */
router.post("/admin/routers/:routerId/force-sync", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ") || !verifyAdminToken(auth.slice(7))) {
    res.status(401).json({ error: "Non authentifié" });
    return;
  }

  const routerId = parseInt(req.params.routerId, 10);
  if (isNaN(routerId)) {
    res.status(400).json({ error: "routerId invalide" });
    return;
  }

  try {
    const result = await forceRouterFullSync(routerId);
    res.json({ ok: true, ...result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

/**
 * POST /api/admin/purge-old-sales-scripts
 *
 * Deletes (in batches) MikHmon sales scripts on a single router whose date is
 * older than the previous calendar month (keeps current + previous month).
 *
 * Batched: each call processes at most `batchSize` scripts (oldest first) and
 * returns `scanned` (= total candidates remaining at the start of this call).
 * The client repeats until `scanned === 0` (or no progress made).
 *
 * On the *final* batch (no more candidates left after this one), the local
 * script-sales cache rows are also purged and the in-memory script cache is
 * cleared so the next sync rebuilds cleanly.
 *
 * Body:
 *   { routerId: number, batchSize?: number }   // batchSize default 50
 */
router.post("/admin/purge-old-sales-scripts", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ") || !verifyAdminToken(auth.slice(7))) {
    res.status(401).json({ error: "Non authentifié" });
    return;
  }

  const body = (req.body ?? {}) as { routerId?: number; batchSize?: number };
  const routerId = Number(body.routerId);
  if (!routerId || Number.isNaN(routerId)) {
    res.status(400).json({ error: "routerId requis" });
    return;
  }
  const batchSize = Math.max(1, Math.min(500, Number(body.batchSize) || 50));

  // Cutoff = first day of previous month. Anything strictly before is removed.
  const now = new Date();
  const cutoffYear  = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const cutoffMonth = now.getMonth() === 0 ? 12 : now.getMonth(); // 1-12, = previous month
  const cutoffDate  = new Date(cutoffYear, cutoffMonth - 1, 1, 0, 0, 0);

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, routerId));
  if (!r) {
    res.status(404).json({ error: "Routeur introuvable" });
    return;
  }

  const conn = { host: r.host, port: r.port, username: r.username, password: r.password };

  try {
    const { purge, cacheRowsDeleted, done } = await withRouterLock(r.id, async () => {
      const purgeRes = await purgeOldMikhmonScripts(conn, cutoffYear, cutoffMonth, { limit: batchSize });

      // Strict completion: nothing left to delete AND no failures in this batch.
      // We deliberately do NOT count `failed` as "processed", because the
      // failed scripts are still on the router and would be re-fetched on the
      // next sync. Cache cleanup must only happen on a truly clean finish.
      const remainingAfter = Math.max(0, purgeRes.scanned - purgeRes.removed);
      const isDone = remainingAfter === 0 && purgeRes.failed === 0;

      let cacheDeleted = 0;
      if (isDone) {
        // Last batch and clean: purge corresponding rows from the local cache
        // so the next sync does not re-attempt to use them.
        const rows = await db
          .delete(scriptSalesTable)
          .where(and(
            eq(scriptSalesTable.routerId, r.id),
            sql`${scriptSalesTable.saleDate} < ${cutoffDate.toISOString()}`,
          ))
          .returning({ id: scriptSalesTable.id });
        cacheDeleted = rows.length;

        // Force the next syncScriptCache call to do a full reload so its
        // internal "fully populated" flag aligns with the new state.
        clearRouterScriptCache(r.id);
      }

      return { purge: purgeRes, cacheRowsDeleted: cacheDeleted, done: isDone };
    });

    // remaining = candidates still on the router after this batch (failures
    // are still candidates because they were not removed).
    const remaining = Math.max(0, purge.scanned - purge.removed);

    res.json({
      cutoff: `${cutoffYear}-${String(cutoffMonth).padStart(2, "0")}-01`,
      keptMonths: "Mois courant + mois précédent",
      router: {
        routerId: r.id,
        routerName: r.name ?? r.host,
        routerHost: r.host,
      },
      batchSize,
      done,
      removed: purge.removed,
      failed: purge.failed,
      scanned: purge.scanned,        // total candidates at start of this batch
      remaining,                     // candidates still pending after this batch
      byMonth: purge.byMonth,        // breakdown of what was removed in this batch
      cacheRowsDeleted,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Erreur routeur" });
  }
});

export default router;
