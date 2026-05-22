import type { Request, Response, NextFunction } from "express";
import { eq, sql } from "drizzle-orm";
import { db, adminSettingsTable, managersTable, vendorsTable, collaborateursTable } from "@workspace/db";
import { verifyAdminTokenFull } from "./admin-auth.js";
import { verifyToken as verifyManagerToken } from "./manager-auth.js";
import { verifyToken as verifyVendorToken } from "./vendor-auth.js";
import { verifyToken as verifyCollaborateurToken } from "./collaborateur-auth.js";
import { isUserSessionActive, revokeUserSessionById } from "./user-session-store.js";

/** Réponse 401 quand cette session appareil a été révoquée (logout / idle). */
export const SESSION_REVOKED_CODE = "SESSION_REVOKED";

function skipSessionEpochCheck(req: Request): boolean {
  if (req.method === "OPTIONS") return true;
  const p = req.path;
  if (req.method === "GET" && p === "/healthz") return true;
  if (
    req.method === "POST"
    && (p === "/login"
      || p === "/login/security-required"
      || p === "/auth/sign-in"
      || p === "/auth/security-required"
      || p === "/verify-code")
  ) {
    return true;
  }
  if (req.method === "POST" && p === "/vendor-portal/login") return true;
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return true;
  return false;
}

async function sessionRevoked(res: Response): Promise<void> {
  res.status(401).json({ error: "Session expirée", code: SESSION_REVOKED_CODE });
}

async function validatePerDeviceSession(sessionId: string | undefined, res: Response): Promise<boolean> {
  if (!sessionId) return true;
  if (!(await isUserSessionActive(sessionId))) {
    await sessionRevoked(res);
    return false;
  }
  return true;
}

async function validateLegacyEpoch(
  tokenEpoch: number,
  dbEpoch: number,
  res: Response,
): Promise<boolean> {
  if (tokenEpoch !== dbEpoch) {
    await sessionRevoked(res);
    return false;
  }
  return true;
}

/**
 * Valide le jeton Bearer : session par appareil (user_sessions) ou epoch global (anciens jetons).
 */
export async function sessionEpochMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (skipSessionEpochCheck(req)) {
    next();
    return;
  }
  const token = req.headers.authorization!.slice(7);

  const admin = verifyAdminTokenFull(token);
  if (admin) {
    if (!(await validatePerDeviceSession(admin.sessionId, res))) return;
    if (!admin.sessionId) {
      const [row] = await db
        .select({ sessionEpoch: adminSettingsTable.sessionEpoch })
        .from(adminSettingsTable)
        .where(eq(adminSettingsTable.id, admin.adminId))
        .limit(1);
      if (!(await validateLegacyEpoch(admin.sessionEpoch, row?.sessionEpoch ?? 0, res))) return;
    }
    next();
    return;
  }

  const mgr = verifyManagerToken(token);
  if (mgr) {
    if (!(await validatePerDeviceSession(mgr.sessionId, res))) return;
    if (!mgr.sessionId) {
      const [row] = await db
        .select({ sessionEpoch: managersTable.sessionEpoch })
        .from(managersTable)
        .where(eq(managersTable.id, mgr.managerId))
        .limit(1);
      if (!(await validateLegacyEpoch(mgr.sessionEpoch, row?.sessionEpoch ?? 0, res))) return;
    }
    next();
    return;
  }

  const vnd = verifyVendorToken(token);
  if (vnd) {
    if (!(await validatePerDeviceSession(vnd.sessionId, res))) return;
    if (!vnd.sessionId) {
      const [row] = await db
        .select({ sessionEpoch: vendorsTable.sessionEpoch })
        .from(vendorsTable)
        .where(eq(vendorsTable.id, vnd.vendorId))
        .limit(1);
      if (!(await validateLegacyEpoch(vnd.sessionEpoch, row?.sessionEpoch ?? 0, res))) return;
    }
    next();
    return;
  }

  const col = verifyCollaborateurToken(token);
  if (col) {
    if (!(await validatePerDeviceSession(col.sessionId, res))) return;
    if (!col.sessionId) {
      const [row] = await db
        .select({ sessionEpoch: collaborateursTable.sessionEpoch })
        .from(collaborateursTable)
        .where(eq(collaborateursTable.id, col.collaborateurId))
        .limit(1);
      if (!(await validateLegacyEpoch(col.sessionEpoch, row?.sessionEpoch ?? 0, res))) return;
    }
    next();
    return;
  }

  next();
}

/** Révoque uniquement la session de l'appareil courant (logout / idle). */
export async function revokeSessionForToken(token: string): Promise<boolean> {
  const admin = verifyAdminTokenFull(token);
  if (admin) {
    if (admin.sessionId) return revokeUserSessionById(admin.sessionId);
    return incrementSessionEpochForToken(token);
  }
  const mgr = verifyManagerToken(token);
  if (mgr) {
    if (mgr.sessionId) return revokeUserSessionById(mgr.sessionId);
    return incrementSessionEpochForToken(token);
  }
  const vnd = verifyVendorToken(token);
  if (vnd) {
    if (vnd.sessionId) return revokeUserSessionById(vnd.sessionId);
    return incrementSessionEpochForToken(token);
  }
  const col = verifyCollaborateurToken(token);
  if (col) {
    if (col.sessionId) return revokeUserSessionById(col.sessionId);
    return incrementSessionEpochForToken(token);
  }
  return false;
}

/** Invalidation globale — anciens jetons sans session_id par appareil. */
export async function incrementSessionEpochForToken(token: string): Promise<boolean> {
  const admin = verifyAdminTokenFull(token);
  if (admin) {
    await db
      .update(adminSettingsTable)
      .set({ sessionEpoch: sql`${adminSettingsTable.sessionEpoch} + 1` })
      .where(eq(adminSettingsTable.id, admin.adminId));
    return true;
  }
  const mgr = verifyManagerToken(token);
  if (mgr) {
    await db
      .update(managersTable)
      .set({ sessionEpoch: sql`${managersTable.sessionEpoch} + 1` })
      .where(eq(managersTable.id, mgr.managerId));
    return true;
  }
  const vnd = verifyVendorToken(token);
  if (vnd) {
    await db
      .update(vendorsTable)
      .set({ sessionEpoch: sql`${vendorsTable.sessionEpoch} + 1` })
      .where(eq(vendorsTable.id, vnd.vendorId));
    return true;
  }
  const col = verifyCollaborateurToken(token);
  if (col) {
    await db
      .update(collaborateursTable)
      .set({ sessionEpoch: sql`${collaborateursTable.sessionEpoch} + 1` })
      .where(eq(collaborateursTable.id, col.collaborateurId));
    return true;
  }
  return false;
}
