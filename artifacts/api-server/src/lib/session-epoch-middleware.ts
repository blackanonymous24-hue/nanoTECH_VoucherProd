import type { Request, Response, NextFunction } from "express";
import { eq, sql } from "drizzle-orm";
import { db, adminSettingsTable, managersTable, vendorsTable, collaborateursTable } from "@workspace/db";
import { verifyAdminTokenFull } from "./admin-auth.js";
import { verifyToken as verifyManagerToken } from "./manager-auth.js";
import { verifyToken as verifyVendorToken } from "./vendor-auth.js";
import { verifyToken as verifyCollaborateurToken } from "./collaborateur-auth.js";

/** Réponse 401 quand un autre appareil a révoqué la session (logout / idle). */
export const SESSION_REVOKED_CODE = "SESSION_REVOKED";

function skipSessionEpochCheck(req: Request): boolean {
  if (req.method === "OPTIONS") return true;
  const p = req.path;
  if (req.method === "GET" && p === "/healthz") return true;
  if (req.method === "POST" && (p === "/login" || p === "/verify-code")) return true;
  if (req.method === "POST" && p === "/vendor-portal/login") return true;
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return true;
  return false;
}

/**
 * Vérifie que le jeton Bearer porte le même session_epoch que la ligne SQL.
 */
export async function sessionEpochMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (skipSessionEpochCheck(req)) {
    next();
    return;
  }
  const token = req.headers.authorization!.slice(7);

  const admin = verifyAdminTokenFull(token);
  if (admin) {
    const [row] = await db
      .select({ sessionEpoch: adminSettingsTable.sessionEpoch })
      .from(adminSettingsTable)
      .where(eq(adminSettingsTable.id, admin.adminId))
      .limit(1);
    const dbEpoch = row?.sessionEpoch ?? 0;
    if (admin.sessionEpoch !== dbEpoch) {
      res.status(401).json({ error: "Session expirée", code: SESSION_REVOKED_CODE });
      return;
    }
    next();
    return;
  }

  const mgr = verifyManagerToken(token);
  if (mgr) {
    const [row] = await db
      .select({ sessionEpoch: managersTable.sessionEpoch })
      .from(managersTable)
      .where(eq(managersTable.id, mgr.managerId))
      .limit(1);
    const dbEpoch = row?.sessionEpoch ?? 0;
    if (mgr.sessionEpoch !== dbEpoch) {
      res.status(401).json({ error: "Session expirée", code: SESSION_REVOKED_CODE });
      return;
    }
    next();
    return;
  }

  const vnd = verifyVendorToken(token);
  if (vnd) {
    const [row] = await db
      .select({ sessionEpoch: vendorsTable.sessionEpoch })
      .from(vendorsTable)
      .where(eq(vendorsTable.id, vnd.vendorId))
      .limit(1);
    const dbEpoch = row?.sessionEpoch ?? 0;
    if (vnd.sessionEpoch !== dbEpoch) {
      res.status(401).json({ error: "Session expirée", code: SESSION_REVOKED_CODE });
      return;
    }
    next();
    return;
  }

  const col = verifyCollaborateurToken(token);
  if (col) {
    const [row] = await db
      .select({ sessionEpoch: collaborateursTable.sessionEpoch })
      .from(collaborateursTable)
      .where(eq(collaborateursTable.id, col.collaborateurId))
      .limit(1);
    const dbEpoch = row?.sessionEpoch ?? 0;
    if (col.sessionEpoch !== dbEpoch) {
      res.status(401).json({ error: "Session expirée", code: SESSION_REVOKED_CODE });
      return;
    }
    next();
    return;
  }

  next();
}

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
