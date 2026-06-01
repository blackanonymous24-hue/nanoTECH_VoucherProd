import { Router, type Request, type Response } from "express";
import { eq, and, ne, sql } from "drizzle-orm";
import {
  credentialsMatchOriginalSuperAdmin,
  getOriginalSuperAdminRow,
  isValidSuperSecurityCode,
} from "../lib/original-super-admin.js";
import { db, adminSettingsTable, vendorsTable, managersTable, managerRoutersTable, routersTable, collaborateursTable, collaborateurRoutersTable } from "@workspace/db";
import { hashPassword, verifyPassword, createAdminToken, verifyAdminToken, verifyAdminTokenFull } from "../lib/admin-auth.js";
import { verifyPassword as verifyVendorPassword, createToken as createVendorToken, verifyToken as verifyVendorToken } from "../lib/vendor-auth.js";
import { verifyPassword as verifyManagerPassword, createToken as createManagerToken, verifyToken as verifyManagerToken } from "../lib/manager-auth.js";
import { verifyPassword as verifyCollabPassword, createToken as createCollabToken, verifyToken as verifyCollaborateurToken } from "../lib/collaborateur-auth.js";
import { purgePhantomVouchers, forceRouterFullSync } from "../lib/vendor-sync.js";
import {
  countOldMikhmonScriptsBeforeCutoff,
  purgeOldMikhmonScriptsBatch,
  type ScriptPurgeBatchCursor,
} from "../lib/mikrotik.js";
import { withRouterLock } from "../lib/router-lock.js";
import { resetRouterSalesCache, syncScriptCache } from "../lib/script-cache.js";
import { setAdminCredentialPreview } from "../lib/admin-credential-preview.js";
import { logger } from "../lib/logger.js";
import { revokeSessionForToken } from "../lib/session-epoch-middleware.js";
import {
  newSessionId,
  registerUserSessionFromRequest,
} from "../lib/user-session-store.js";
import {
  adminLoginPasswordCollisionMessage,
  findAdminLoginPasswordHashCollision,
  authenticateAdminByCredentials,
} from "../lib/admin-login-unique.js";

const router = Router();

/** Parse le JSON des échelles per-template stocké en base. */
function parsePrintScales(raw: string | null | undefined): Record<string, number> {
  try { return (raw ? JSON.parse(raw) : {}) as Record<string, number>; } catch { return {}; }
}

/**
 * Slugs acceptés en `admin_settings.ticket_template_preset` :
 *   - "custom"                  — modèle édité à la main par l'admin
 *   - "mikhmon-small" / "nanotech-normal" / "nanotech-small" — factory embarqués côté client
 *   - n'importe quel slug ajouté par le super-admin (table `builtin_ticket_templates`)
 *
 * On ne vérifie volontairement pas l'existence en base : si le super-admin supprime
 * plus tard un slug que des admins ont déjà sauvegardé, leur `ticket_template` reste
 * valide (le body est persisté en `admin_settings.ticket_template`).
 */
const TICKET_PRESET_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-_]{0,62}[a-z0-9])?$/;

/** undefined = ne pas modifier la colonne ; sinon valeur à enregistrer (y compris null explicite). */
function parseTicketTemplatePresetBody(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== "string") return undefined;
  if (raw === "custom") return raw;
  return TICKET_PRESET_SLUG_PATTERN.test(raw) ? raw : undefined;
}

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

// POST /api/login/security-required — champ code uniquement si login + mot de passe = super-admin originel.
// Alias /api/auth/security-required : certains bloqueurs de pub bloquent les URL contenant « /login ».
async function postLoginSecurityRequired(req: Request, res: Response): Promise<void> {
  try {
    const { login, password } = req.body as { login?: string; password?: string };
    const loginTrimmed = String(login ?? "").trim();
    if (!loginTrimmed || !password) {
      res.json({ required: false });
      return;
    }
    await getOrInitSuperAdmin();
    const required = await credentialsMatchOriginalSuperAdmin(loginTrimmed, password);
    res.json({ required });
  } catch (err) {
    logger.error({ err }, "POST login security-required");
    res.json({ required: false });
  }
}
router.post("/login/security-required", postLoginSecurityRequired);
router.post("/auth/security-required", postLoginSecurityRequired);

async function postLogin(req: Request, res: Response): Promise<void> {
  try {
  const { login, password, verificationCode } = req.body as {
    login?: string;
    password?: string;
    verificationCode?: string;
  };
  if (!login || !password) {
    res.status(400).json({ error: "Identifiants requis" });
    return;
  }
  const loginTrimmed = login.trim();
  // Mot de passe : octets exacts (sensible à la casse, pas de trim ni lower).

  // Make sure the super-admin seed exists before the lookup.
  await getOrInitSuperAdmin();

  const adminRow = await authenticateAdminByCredentials(loginTrimmed, password);

  if (adminRow) {
      const original = await getOriginalSuperAdminRow();
      if (original && adminRow.id === original.id) {
        if (!isValidSuperSecurityCode(verificationCode, adminRow.verificationCode)) {
          res.status(403).json({ error: "Code de sécurité incorrect ou manquant" });
          return;
        }
      }
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
      const adminSessionId = newSessionId();
      await registerUserSessionFromRequest(req, {
        sessionId: adminSessionId,
        userType: "admin",
        userId: adminRow.id,
      });
      res.json({
        role: "admin",
        isSuperAdmin: adminRow.isSuperAdmin,
        token: createAdminToken(adminRow.id, adminRow.isSuperAdmin, adminRow.sessionEpoch ?? 0, adminSessionId),
        admin: {
          id: adminRow.id,
          login: adminRow.login,
          displayName: adminRow.displayName,
          isSuperAdmin: adminRow.isSuperAdmin,
        },
      });
    return;
  }

  const [manager] = await db
    .select()
    .from(managersTable)
    .where(eq(managersTable.username, loginTrimmed));

  if (manager?.passwordHash && manager.isActive) {
    const valid = await verifyManagerPassword(password, manager.passwordHash);
    if (valid) {
      const mgrRouterRows = await db
        .select({ routerId: managerRoutersTable.routerId })
        .from(managerRoutersTable)
        .where(eq(managerRoutersTable.managerId, manager.id));
      let routerIds = mgrRouterRows.map((r) => r.routerId);
      if (routerIds.length === 0 && manager.routerId != null) {
        routerIds = [manager.routerId];
      }
      const managerSessionId = newSessionId();
      await registerUserSessionFromRequest(req, {
        sessionId: managerSessionId,
        userType: "manager",
        userId: manager.id,
      });
      res.json({
        role: "manager",
        token: createManagerToken(manager.id, routerIds, manager.sessionEpoch ?? 0, managerSessionId),
        manager: {
          id: manager.id,
          name: manager.name,
          username: manager.username,
          routerIds,
          routerId: routerIds[0] ?? null,
        },
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
      const vendorSessionId = newSessionId();
      await registerUserSessionFromRequest(req, {
        sessionId: vendorSessionId,
        userType: "vendor",
        userId: vendor.id,
      });
      res.json({
        role: "vendor",
        token: createVendorToken(vendor.id, vendor.sessionEpoch ?? 0, vendorSessionId),
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
      const collabSessionId = newSessionId();
      await registerUserSessionFromRequest(req, {
        sessionId: collabSessionId,
        userType: "collaborateur",
        userId: collab.id,
      });
      res.json({
        role: "collaborateur",
        token: createCollabToken(collab.id, routerIds, collab.sessionEpoch ?? 0, collabSessionId),
        collaborateur: { id: collab.id, name: collab.name, username: collab.username, routerIds },
      });
      return;
    }
  }

  res.status(401).json({ error: "Identifiants incorrects" });
  } catch (err) {
    logger.error({ err }, "POST login");
    res.status(503).json({
      error:
        "Erreur serveur ou base de données (schéma incomplet ou indisponible). Redémarrez l’API après mise à jour, exécutez les migrations Drizzle, puis réessayez.",
    });
  }
}
router.post("/login", postLogin);
router.post("/auth/sign-in", postLogin);

/** Révoque uniquement la session de l'appareil courant (logout / idle). */
router.post("/session/revoke", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Non authentifié" });
    return;
  }
  const ok = await revokeSessionForToken(auth.slice(7));
  if (!ok) {
    res.status(401).json({ error: "Non authentifié" });
    return;
  }
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// POST /api/verify-code { code } — Valide un code de vérification.
// Code "4155" accepté par défaut. Sinon, comparé au verificationCode de chaque super admin.
// ---------------------------------------------------------------------------
router.post("/verify-code", async (req, res): Promise<void> => {
  const { code } = req.body as { code?: string };
  if (!code?.trim()) { res.status(400).json({ valid: false, error: "Code requis" }); return; }
  if (isValidSuperSecurityCode(code, null)) { res.json({ valid: true }); return; }
  const superAdmins = await db
    .select({ verificationCode: adminSettingsTable.verificationCode })
    .from(adminSettingsTable)
    .where(eq(adminSettingsTable.isSuperAdmin, true));
  const valid = superAdmins.some((a) => isValidSuperSecurityCode(code, a.verificationCode));
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
  const [current] = await db
    .select()
    .from(adminSettingsTable)
    .where(eq(adminSettingsTable.id, claims.adminId));
  if (!current) {
    res.status(404).json({ error: "Compte introuvable" });
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

  const nextLogin = patch.login ?? current.login;
  if (password !== undefined) {
    const collision = await adminLoginPasswordCollisionMessage(nextLogin, password, claims.adminId);
    if (collision) {
      res.status(409).json({ error: collision });
      return;
    }
  } else if (patch.login !== undefined) {
    const hashHit = await findAdminLoginPasswordHashCollision(
      nextLogin,
      current.passwordHash,
      claims.adminId,
    );
    if (hashHit) {
      const kind = hashHit.isSuperAdmin ? "super administrateur" : "administrateur";
      res.status(409).json({
        error: `Un compte ${kind} utilise déjà cet identifiant avec le même mot de passe.`,
      });
      return;
    }
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
    .select({
      ticketTemplate: adminSettingsTable.ticketTemplate,
      ticketTemplatePreset: adminSettingsTable.ticketTemplatePreset,
    })
    .from(adminSettingsTable)
    .where(eq(adminSettingsTable.id, tenantAdminId));

  res.json({
    template: row?.ticketTemplate ?? null,
    presetId: row?.ticketTemplatePreset ?? null,
  });
});

/**
 * GET /api/admin/ticket-template — modèle de l'admin connecté (null = défaut côté client).
 */
router.get("/admin/ticket-template", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  const claims = auth?.startsWith("Bearer ") ? verifyAdminTokenFull(auth.slice(7)) : null;
  if (!claims) { res.status(401).json({ error: "Non authentifié" }); return; }

  const [row] = await db
    .select({
      ticketTemplate: adminSettingsTable.ticketTemplate,
      ticketTemplatePreset: adminSettingsTable.ticketTemplatePreset,
    })
    .from(adminSettingsTable)
    .where(eq(adminSettingsTable.id, claims.adminId));

  res.json({
    template: row?.ticketTemplate ?? null,
    presetId: row?.ticketTemplatePreset ?? null,
  });
});

/**
 * GET /api/admin/print-scale — échelle d'impression (web + mobile) pour sync multi-appareils.
 */
router.get("/admin/print-scale", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  const claims = auth?.startsWith("Bearer ") ? verifyAdminTokenFull(auth.slice(7)) : null;
  if (!claims) { res.status(401).json({ error: "Non authentifié" }); return; }

  const [row] = await db
    .select({ printScales: adminSettingsTable.printScales })
    .from(adminSettingsTable)
    .where(eq(adminSettingsTable.id, claims.adminId));

  const scales = parsePrintScales(row?.printScales);
  res.json({ scales });
});

/**
 * PUT /api/admin/print-scale — body: { templateId: string, scale: number } (0–100).
 */
router.put("/admin/print-scale", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  const claims = auth?.startsWith("Bearer ") ? verifyAdminTokenFull(auth.slice(7)) : null;
  if (!claims) { res.status(401).json({ error: "Non authentifié" }); return; }

  const { templateId, scale } = req.body as { templateId?: unknown; scale?: unknown };
  if (typeof templateId !== "string" || !templateId) {
    res.status(400).json({ error: "Champ templateId requis (string)" });
    return;
  }
  if (typeof scale !== "number" || !Number.isFinite(scale)) {
    res.status(400).json({ error: "Champ scale requis (entier 0–100)" });
    return;
  }
  const scaleVal = Math.min(100, Math.max(0, Math.round(scale)));

  const [row] = await db
    .select({ printScales: adminSettingsTable.printScales })
    .from(adminSettingsTable)
    .where(eq(adminSettingsTable.id, claims.adminId));

  const scales = parsePrintScales(row?.printScales);
  scales[templateId] = scaleVal;
  await db.update(adminSettingsTable)
    .set({ printScales: JSON.stringify(scales) })
    .where(eq(adminSettingsTable.id, claims.adminId));
  res.json({ ok: true });
});

/**
 * POST /api/admin/print-scale/broadcast — super admin seulement.
 * Copie l'échelle du template demandé vers TOUS les comptes.
 * body: { templateId: string, scale?: number } — si `scale` est fourni (0–100), cette valeur est appliquée ; sinon l'échelle enregistrée pour le compte super admin pour ce template.
 */
router.post("/admin/print-scale/broadcast", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  const claims = auth?.startsWith("Bearer ") ? verifyAdminTokenFull(auth.slice(7)) : null;
  if (!claims) { res.status(401).json({ error: "Non authentifié" }); return; }
  if (!claims.isSuperAdmin) { res.status(403).json({ error: "Réservé au super admin" }); return; }

  const { templateId, scale } = req.body as { templateId?: unknown; scale?: unknown };
  if (typeof templateId !== "string" || !templateId) {
    res.status(400).json({ error: "Champ templateId requis (string)" });
    return;
  }

  let scaleVal: number;
  if (typeof scale === "number" && Number.isFinite(scale)) {
    scaleVal = Math.min(100, Math.max(0, Math.round(scale)));
  } else {
    const [superRow] = await db
      .select({ printScales: adminSettingsTable.printScales })
      .from(adminSettingsTable)
      .where(eq(adminSettingsTable.id, claims.adminId));

    const superScales = parsePrintScales(superRow?.printScales);
    scaleVal = superScales[templateId] ?? 85;
  }

  const allRows = await db
    .select({ id: adminSettingsTable.id, printScales: adminSettingsTable.printScales })
    .from(adminSettingsTable);

  for (const r of allRows) {
    const s = parsePrintScales(r.printScales);
    s[templateId] = scaleVal;
    await db.update(adminSettingsTable)
      .set({ printScales: JSON.stringify(s) })
      .where(eq(adminSettingsTable.id, r.id));
  }

  res.json({ ok: true, appliedScale: scaleVal, affectedAccounts: allRows.length });
});

/**
 * PUT /api/admin/ticket-template — body: { template: string, presetId?: string | null }
 * (vide = réinitialiser le HTML ; presetId omis = ne pas changer la colonne preset).
 */
router.put("/admin/ticket-template", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  const claims = auth?.startsWith("Bearer ") ? verifyAdminTokenFull(auth.slice(7)) : null;
  if (!claims) { res.status(401).json({ error: "Non authentifié" }); return; }

  const { template, presetId } = req.body as { template?: unknown; presetId?: unknown };
  if (typeof template !== "string") {
    res.status(400).json({ error: "Champ template requis (string)" });
    return;
  }

  const presetField = parseTicketTemplatePresetBody(presetId);
  const setPayload: {
    ticketTemplate: string | null;
    ticketTemplatePreset?: string | null;
  } = { ticketTemplate: template.trim() || null };
  if (presetField !== undefined) {
    setPayload.ticketTemplatePreset = presetField;
  }

  await db
    .update(adminSettingsTable)
    .set(setPayload)
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
/**
 * POST /api/admin/routers/:routerId/reset-sales-cache
 * Efface mikrotik_script_sales + marqueurs de sync pour ce routeur, puis resync le mois en cours.
 */
router.post("/admin/routers/:routerId/reset-sales-cache", async (req, res): Promise<void> => {
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

  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, routerId));
  if (!r) {
    res.status(404).json({ error: "Routeur introuvable" });
    return;
  }

  try {
    const cleared = await resetRouterSalesCache(routerId);
    const conn = { host: r.host, port: r.port, username: r.username, password: r.password };
    const inserted = await syncScriptCache(routerId, conn, null, {
      forDashboard: true,
      forceFullMonth: true,
      skipBackfill: true,
    });
    res.json({ ok: true, ...cleared, scriptInserted: inserted });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

/**
 * POST /api/admin/reset-all-sales-cache
 * Réinitialise le cache ventes de tous les routeurs puis resync le mois en cours (un par un).
 */
router.post("/admin/reset-all-sales-cache", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ") || !verifyAdminToken(auth.slice(7))) {
    res.status(401).json({ error: "Non authentifié" });
    return;
  }

  const routers = await db.select().from(routersTable);
  const results: { routerId: number; name: string; deletedSales: number; scriptInserted: number; error?: string }[] = [];

  for (const r of routers) {
    try {
      const cleared = await resetRouterSalesCache(r.id);
      const conn = { host: r.host, port: r.port, username: r.username, password: r.password };
      const inserted = await syncScriptCache(r.id, conn, null, {
        forDashboard: true,
        forceFullMonth: true,
        skipBackfill: true,
      });
      results.push({
        routerId: r.id,
        name: r.name ?? r.host,
        deletedSales: cleared.deletedSales,
        scriptInserted: inserted,
      });
    } catch (err: unknown) {
      results.push({
        routerId: r.id,
        name: r.name ?? r.host,
        deletedSales: 0,
        scriptInserted: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  res.json({ ok: true, routers: results.length, results });
});

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
 * Suppression des scripts MikHmon antérieurs au mois précédent
 * (conserve mois courant + mois précédent) sur un routeur donné.
 *
 * Mode batch (UI) : scans ciblés `?owner=MMYYYY` par mois, lots de `batchSize`
 * scripts, curseur `cursor` pour reprendre. Premier appel renvoie aussi
 * `totalCandidates` (comptage rapide owner-only) pour la barre de progression.
 *
 * La base PostgreSQL locale (`mikrotik_script_sales`) n'est JAMAIS touchée.
 *
 * Body : { routerId: number, batchSize?: number, cursor?: { year, month } | null }
 */
router.post("/admin/purge-old-sales-scripts", async (req, res): Promise<void> => {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ") || !verifyAdminToken(auth.slice(7))) {
    res.status(401).json({ error: "Non authentifié" });
    return;
  }

  const body = (req.body ?? {}) as {
    routerId?: number;
    batchSize?: number;
    cursor?: ScriptPurgeBatchCursor | null;
  };
  const routerId = Number(body.routerId);
  if (!routerId || Number.isNaN(routerId)) {
    res.status(400).json({ error: "routerId requis" });
    return;
  }
  const batchSize = Math.max(1, Math.min(500, Number(body.batchSize) || 200));
  const cursor = body.cursor ?? null;

  // Cutoff = 1er jour du mois précédent. Tout ce qui est strictement avant est purgé.
  const now = new Date();
  const cutoffYear  = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const cutoffMonth = now.getMonth() === 0 ? 12 : now.getMonth(); // 1-12, = mois précédent
  const [r] = await db.select().from(routersTable).where(eq(routersTable.id, routerId));
  if (!r) {
    res.status(404).json({ error: "Routeur introuvable" });
    return;
  }

  const conn = { host: r.host, port: r.port, username: r.username, password: r.password };

  try {
    const { purge, totalCandidates } = await withRouterLock(r.id, async () => {
      let totalCandidates: number | undefined;
      if (cursor == null) {
        totalCandidates = await countOldMikhmonScriptsBeforeCutoff(conn, cutoffYear, cutoffMonth);
      }
      const purgeRes = await purgeOldMikhmonScriptsBatch(conn, cutoffYear, cutoffMonth, {
        limit: batchSize,
        cursor,
      });
      return { purge: purgeRes, totalCandidates };
    });

    const done = purge.purgeComplete && purge.failed === 0;

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
      scanned: purge.scanned,
      remaining: purge.remaining,
      totalCandidates,
      nextCursor: purge.nextCursor,
      byMonth: purge.byMonth,
      cacheRowsDeleted: 0,
      cacheKept: true,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Erreur routeur" });
  }
});

export default router;
