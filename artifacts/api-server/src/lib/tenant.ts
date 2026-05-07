import type { Request, Response } from "express";
import { verifyAdminTokenFull } from "./admin-auth.js";

/**
 * Tenant scope derived from an admin Bearer token.
 * - `adminId`        : id of the authenticated admin (for ownerAdminId filtering)
 * - `isSuperAdmin`   : rôle plateforme ; le périmètre des données (tous tenants vs
 *   un seul) dépend de chaque route (ex. liste routeurs = propriétaire JWT ;
 *   console super = endpoints `/api/super/...`).
 * - `isImpersonating`: vrai quand le super-admin agit au nom d'un autre tenant via
 *   le header X-Impersonate-Admin. Dans ce cas `adminId` est l'id du tenant cible
 *   et les requêtes doivent appliquer les mêmes filtres qu'un admin ordinaire.
 */
export interface AdminScope {
  adminId: number;
  isSuperAdmin: boolean;
  isImpersonating?: boolean;
}

/**
 * Résout l'impersonation super-admin → tenant cible.
 * Si le header X-Impersonate-Admin est présent et valide, `adminId` est remplacé
 * par l'id cible et `isImpersonating` est levé pour que les routes appliquent
 * les filtres tenant normaux.
 */
export function applyImpersonation(req: Request, claims: { adminId: number; isSuperAdmin: boolean }): AdminScope {
  if (!claims.isSuperAdmin) return { ...claims };
  const header = req.headers["x-impersonate-admin"];
  const targetId = typeof header === "string" ? parseInt(header, 10) : NaN;
  if (!isNaN(targetId) && targetId > 0 && targetId !== claims.adminId) {
    return { adminId: targetId, isSuperAdmin: true, isImpersonating: true };
  }
  return { ...claims };
}

/**
 * Extract the admin scope from the request, or send a 401/403 response and
 * return null. Use this at the top of any admin-only route that needs to
 * scope queries by tenant.
 *
 * Supports super-admin impersonation via X-Impersonate-Admin header.
 */
export function requireAdminScope(req: Request, res: Response): AdminScope | null {
  const auth = req.headers.authorization;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  const claims = token ? verifyAdminTokenFull(token) : null;
  if (!claims) {
    res.status(401).json({ error: "Non authentifié" });
    return null;
  }
  return applyImpersonation(req, claims);
}

/**
 * Like `requireAdminScope` but additionally enforces the super-admin role.
 * Used to gate the /api/super/** endpoints.
 */
export function requireSuperAdminScope(req: Request, res: Response): AdminScope | null {
  const auth = req.headers.authorization;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  const claims = token ? verifyAdminTokenFull(token) : null;
  if (!claims) {
    res.status(401).json({ error: "Non authentifié" });
    return null;
  }
  if (!claims.isSuperAdmin) {
    res.status(403).json({ error: "Réservé au super administrateur" });
    return null;
  }
  return applyImpersonation(req, claims);
}
