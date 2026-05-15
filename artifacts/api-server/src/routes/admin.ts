import { Router } from "express";
import { eq, and, ne, sql } from "drizzle-orm";
import { db, adminSettingsTable, vendorsTable, managersTable, routersTable, collaborateursTable, collaborateurRoutersTable, scriptSalesTable } from "@workspace/db";
import { hashPassword, verifyPassword, createAdminToken, verifyAdminToken, verifyAdminTokenFull } from "../lib/admin-auth.js";
import { verifyPassword as verifyVendorPassword, createToken as createVendorToken, verifyToken as verifyVendorToken } from "../lib/vendor-auth.js";
import { verifyPassword as verifyManagerPassword, createToken as createManagerToken, verifyToken as verifyManagerToken } from "../lib/manager-auth.js";
import { verifyPassword as verifyCollabPassword, createToken as createCollabToken, verifyToken as verifyCollaborateurToken } from "../lib/collaborateur-auth.js";
import { purgePhantomVouchers, forceRouterFullSync } from "../lib/vendor-sync.js";
import { purgeOldMikhmonScripts } from "../lib/mikrotik.js";
import { withRouterLock } from "../lib/router-lock.js";
import { clearRouterScriptCache } from "../lib/script-cache.js";
import { setAdminCredentialPreview } from "../lib/admin-credential-preview.js";
import { logger } from "../lib/logger.js";

const router = Router();

/**
 * Ensure that at least one super-admin exists. On a fresh database we seed
 * one with login="admin" / password="root". On an existing database we make
 * sure the original first admin row carries the is_super_admin flag (the
 * migration backfill already does this, but this is idempotent and survives
 * accidental flag flips).
 */
async function getOrInitSuperAdmin(): Promise<typeof adminSettingsTable.$inferSelect> {
  const supers = await db.select().from(adminSettingsTable).where(eq(adminSettingsTable.isSuperAdmin, true)).limit(1);
  if (supers.length > 0) return supers[0];
  // Promote any existing admin to super before creating a new one.
  const any = await db.select().from(adminSettingsTable).limit(1);
  if (any.length > 0) {
    const [promoted] = await db
      .update(adminSettingsTable)
      .set({ isSuperAdmin: true, isActive: true })
      .where(eq(adminSettingsTable.id, any[0].id))
      .returning();
    return promoted;
  }
  // Truly empty database: seed.
  const passwordHash = await hashPassword("root");
  const [created] = await db
    .insert(adminSettingsTable)
    .values({ login: "admin", passwordHash, isSuperAdmin: true, isActive: true })
    .returning();
  return created;
}

router.post("/login", async (req, res): Promise<void> => {
  try {
  const { login, password } = req.body as { login?: string; password?: string };
  if (!login || !password) {
    res.status(400).json({ error: "Identifiants requis" });
    return;
  }
  const loginTrimmed = login.trim();

  // Make sure the super-admin seed exists before the lookup.
  await getOrInitSuperAdmin();

  // Admin lookup by login — plusieurs admins peuvent avoir le même login
  // (mots de passe différents). On essaie chacun jusqu'à trouver le bon.
  const adminRows = await db
    .select()
    .from(adminSettingsTable)
    .where(eq(adminSettingsTable.login, loginTrimmed));

  let adminRow = adminRows[0] as (typeof adminRows)[0] | undefined;
  if (adminRows.length > 1) {
    // Trouver le premier dont le mot de passe correspond
    for (const row of adminRows) {
      if (await verifyPassword(password, row.passwordHash)) { adminRow = row; break; }
    }
  }

  if (adminRow) {
    const valid = await verifyPassword(password, adminRow.passwordHash);
    if (valid) {
      // Account-level gates. Super admins bypass the forfait check (they
      // don't have a forfait — they manage them).
      if (!adminRow.isActive) {
        res.status(403).json({ error: "Compte désactivé" });
        return;
      }
      if (!adminRow.isSuperAdmin) {
        // forfaitEndsAt === null means unlimited — only block if a date is set and already passed,
        // or if forfaitStartedAt is also null (forfait never assigned at all).
        const hasNoForfait = adminRow.forfaitEndsAt === null && adminRow.forfaitStartedAt === null;
        const isExpired = adminRow.forfaitEndsAt !== null && adminRow.forfaitEndsAt.getTime() < Date.now();
        if (hasNoForfait || isExpired) {
          res.status(403).json({ error: "Forfait expiré ou non attribué — contactez le super administrateur." });
          return;
        }
      }
      res.json({
        role: "admin",
        isSuperAdmin: adminRow.isSuperAdmin,
        token: createAdminToken(adminRow.id, adminRow.isSuperAdmin),
        admin: {
          id: adminRow.id,
          login: adminRow.login,
          displayName: adminRow.displayName,
          isSuperAdmin: adminRow.isSuperAdmin,
        },
      });
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
  } catch (err) {
    logger.error({ err }, "POST /api/login");
    res.status(503).json({
      error:
        "Erreur serveur ou base de données (schéma incomplet ou indisponible). Redémarrez l’API après mise à jour, exécutez les migrations Drizzle, puis réessayez.",
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/verify-code { code } — Valide un code de vérification.
// Code "4155" accepté par défaut. Sinon, comparé au verificationCode de chaque super admin.
// ---------------------------------------------------------------------------
router.post("/verify-code", async (req, res): Promise<void> => {
  const { code } = req.body as { code?: string };
  if (!code?.trim()) { res.status(400).json({ valid: false, error: "Code requis" }); return; }
  if (code.trim() === "4155") { res.json({ valid: true }); return; }
  const superAdmins = await db
    .select({ verificationCode: adminSettingsTable.verificationCode })
    .from(adminSettingsTable)
    .where(eq(adminSettingsTable.isSuperAdmin, true));
  const valid = superAdmins.some((a) => a.verificationCode && a.verificationCode === code.trim());
  res.json({ valid });
});

router.get("/admin/me", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  const claims = auth?.startsWith("Bearer ") ? verifyAdminTokenFull(auth.slice(7)) : null;
  if (!claims) {
    res.status(401).json({ error: "Non authentifié" });
    return;
  }
  const [adminRow] = await db.select().from(adminSettingsTable).where(eq(adminSettingsTable.id, claims.adminId));
  if (!adminRow) {
    res.status(401).json({ error: "Compte introuvable" });
    return;
  }
  // Live router count for quota display.
  const [{ count: routerCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(routersTable)
    .where(eq(routersTable.ownerAdminId, adminRow.id));
  const baseSlots = 5;
  res.json({
    id: adminRow.id,
    login: adminRow.login,
    displayName: adminRow.displayName,
    isSuperAdmin: adminRow.isSuperAdmin,
    isActive: adminRow.isActive,
    forfaitStartedAt: adminRow.forfaitStartedAt,
    forfaitEndsAt: adminRow.forfaitEndsAt,
    credits: adminRow.credits,
    extraRouterSlots: adminRow.extraRouterSlots,
    routerCount,
    routerLimit: baseSlots + adminRow.extraRouterSlots,
    passwordPlain: adminRow.passwordPlain ?? null,
  });
});

/**
 * PUT /api/admin/credentials
 * Self-service: the authenticated admin (super-admin or regular) updates
 * their own login and/or password. Either field may be omitted to leave
 * it unchanged. Rejects login collisions and enforces minimum lengths.
 */
router.put("/admin/credentials", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  const claims = auth?.startsWith("Bearer ") ? verifyAdminTokenFull(auth.slice(7)) : null;
  if (!claims) {
    res.status(401).json({ error: "Non authentifié" });
    return;
  }
  const { login, password } = req.body as { login?: string; password?: string };

  const patch: Partial<typeof adminSettingsTable.$inferInsert> = {};

  if (login !== undefined) {
    const loginTrimmed = login.trim();
    if (loginTrimmed.length < 1) {
      res.status(400).json({ error: "Login requis" });
      return;
    }
    patch.login = loginTrimmed;
  }

  if (password !== undefined) {
    if (password.length < 1) {
      res.status(400).json({ error: "Mot de passe requis" });
      return;
    }
    patch.passwordHash = await hashPassword(password);
    patch.passwordPlain = password;
  }

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "Aucun champ à mettre à jour" });
    return;
  }

  const [updated] = await db
    .update(adminSettingsTable)
    .set(patch)
    .where(eq(adminSettingsTable.id, claims.adminId))
    .returning({
      id: adminSettingsTable.id,
      login: adminSettingsTable.login,
      displayName: adminSettingsTable.displayName,
      isSuperAdmin: adminSettingsTable.isSuperAdmin,
    });

  setAdminCredentialPreview(updated.id, {
    login: login !== undefined ? updated.login : null,
    password: password !== undefined ? password : null,
    updatedAt: new Date().toISOString(),
  });

  res.json({ ok: true, admin: updated });
});

/**
 * POST /api/admin/buy-routers
 * Self-service: an admin spends 50 credits to unlock 5 extra router slots.
 * Atomic: a single UPDATE … WHERE credits >= 50 prevents racing the wallet.
 */
router.post("/admin/buy-routers", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  const claims = auth?.startsWith("Bearer ") ? verifyAdminTokenFull(auth.slice(7)) : null;
  if (!claims) { res.status(401).json({ error: "Non authentifié" }); return; }
  if (claims.isSuperAdmin) {
    res.status(400).json({ error: "Le super administrateur n'est pas soumis à la limite de routeurs." });
    return;
  }
  const PACK_PRICE  = 50;
  const PACK_SLOTS  = 5;
  // Conditional update — only debits if balance is sufficient.
  const updated = await db
    .update(adminSettingsTable)
    .set({
      credits:          sql`${adminSettingsTable.credits} - ${PACK_PRICE}`,
      extraRouterSlots: sql`${adminSettingsTable.extraRouterSlots} + ${PACK_SLOTS}`,
    })
    .where(and(
      eq(adminSettingsTable.id, claims.adminId),
      sql`${adminSettingsTable.credits} >= ${PACK_PRICE}`,
    ))
    .returning({
      credits: adminSettingsTable.credits,
      extraRouterSlots: adminSettingsTable.extraRouterSlots,
    });
  if (updated.length === 0) {
    res.status(402).json({ error: `Crédits insuffisants (il en faut ${PACK_PRICE}).` });
    return;
  }
  res.json({
    ok: true,
    credits: updated[0].credits,
    extraRouterSlots: updated[0].extraRouterSlots,
    routerLimit: 5 + updated[0].extraRouterSlots,
  });
});

/**
 * GET /api/tenant/ticket-template — modèle PHP/HTML du tenant (propriétaire du jeton).
 */
router.get("/tenant/ticket-template", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Non authentifié" });
    return;
  }
  const token = auth.slice(7);

  let tenantAdminId: number | null = null;
  const adminClaims = verifyAdminTokenFull(token);
  if (adminClaims) {
    tenantAdminId = adminClaims.adminId;
  } else {
    const vnd = verifyVendorToken(token);
    if (vnd) {
      const [row] = await db
        .select({ ownerAdminId: vendorsTable.ownerAdminId, isActive: vendorsTable.isActive })
        .from(vendorsTable)
        .where(eq(vendorsTable.id, vnd.vendorId));
      if (!row?.isActive) {
        res.status(401).json({ error: "Non authentifié" });
        return;
      }
      tenantAdminId = row.ownerAdminId;
    } else {
      const mgr = verifyManagerToken(token);
      if (mgr) {
        const [row] = await db
          .select({ ownerAdminId: managersTable.ownerAdminId, isActive: managersTable.isActive })
          .from(managersTable)
          .where(eq(managersTable.id, mgr.managerId));
        if (!row?.isActive) {
          res.status(401).json({ error: "Non authentifié" });
          return;
        }
        tenantAdminId = row.ownerAdminId;
      } else {
        const col = verifyCollaborateurToken(token);
        if (col) {
          const [row] = await db
            .select({ ownerAdminId: collaborateursTable.ownerAdminId, isActive: collaborateursTable.isActive })
            .from(collaborateursTable)
            .where(eq(collaborateursTable.id, col.collaborateurId));
          if (!row?.isActive) {
            res.status(401).json({ error: "Non authentifié" });
            return;
          }
          tenantAdminId = row.ownerAdminId;
        }
      }
    }
  }

  if (tenantAdminId == null) {
    res.status(401).json({ error: "Non authentifié" });
    return;
  }

  const [row] = await db
    .select({ ticketTemplate: adminSettingsTable.ticketTemplate })
    .from(adminSettingsTable)
    .where(eq(adminSettingsTable.id, tenantAdminId));

  res.json({ template: row?.ticketTemplate ?? null });
});

/**
 * GET /api/admin/ticket-template — modèle de l'admin connecté (null = défaut côté client).
 */
router.get("/admin/ticket-template", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  const claims = auth?.startsWith("Bearer ") ? verifyAdminTokenFull(auth.slice(7)) : null;
  if (!claims) { res.status(401).json({ error: "Non authentifié" }); return; }

  const [row] = await db
    .select({ ticketTemplate: adminSettingsTable.ticketTemplate })
    .from(adminSettingsTable)
    .where(eq(adminSettingsTable.id, claims.adminId));

  res.json({ template: row?.ticketTemplate ?? null });
});

/**
 * GET /api/admin/print-scale — échelle d'impression (web + mobile) pour sync multi-appareils.
 */
router.get("/admin/print-scale", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  const claims = auth?.startsWith("Bearer ") ? verifyAdminTokenFull(auth.slice(7)) : null;
  if (!claims) { res.status(401).json({ error: "Non authentifié" }); return; }

  const [row] = await db
    .select({ printScaleWeb: adminSettingsTable.printScaleWeb, printScaleMobile: adminSettingsTable.printScaleMobile })
    .from(adminSettingsTable)
    .where(eq(adminSettingsTable.id, claims.adminId));

  res.json({
    scaleWeb: row?.printScaleWeb ?? null,
    scaleMobile: row?.printScaleMobile ?? null,
  });
});

/**
 * PUT /api/admin/print-scale — body: { scaleWeb?: number, scaleMobile?: number } (0–100).
 */
router.put("/admin/print-scale", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  const claims = auth?.startsWith("Bearer ") ? verifyAdminTokenFull(auth.slice(7)) : null;
  if (!claims) { res.status(401).json({ error: "Non authentifié" }); return; }

  const { scaleWeb, scaleMobile } = req.body as { scaleWeb?: unknown; scaleMobile?: unknown };
  const toInt = (v: unknown) => (typeof v === "number" && Number.isFinite(v)) ? Math.min(100, Math.max(0, Math.round(v))) : undefined;
  const webVal = toInt(scaleWeb);
  const mobileVal = toInt(scaleMobile);

  if (webVal === undefined && mobileVal === undefined) {
    res.status(400).json({ error: "Au moins scaleWeb ou scaleMobile requis (entier 0–100)" });
    return;
  }

  const patch: Partial<{ printScaleWeb: number; printScaleMobile: number }> = {};
  if (webVal !== undefined) patch.printScaleWeb = webVal;
  if (mobileVal !== undefined) patch.printScaleMobile = mobileVal;

  await db.update(adminSettingsTable).set(patch).where(eq(adminSettingsTable.id, claims.adminId));
  res.json({ ok: true });
});

/**
 * PUT /api/admin/ticket-template — body: { template: string } (vide = réinitialiser).
 */
router.put("/admin/ticket-template", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  const claims = auth?.startsWith("Bearer ") ? verifyAdminTokenFull(auth.slice(7)) : null;
  if (!claims) { res.status(401).json({ error: "Non authentifié" }); return; }

  const { template } = req.body as { template?: string };
  if (typeof template !== "string") {
    res.status(400).json({ error: "Champ template requis (string)" });
    return;
  }

  await db
    .update(adminSettingsTable)
    .set({ ticketTemplate: template.trim() || null })
    .where(eq(adminSettingsTable.id, claims.adminId));

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
