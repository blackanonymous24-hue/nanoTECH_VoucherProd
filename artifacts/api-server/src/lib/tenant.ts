import type { Request, Response } from "express";
import { verifyAdminTokenFull } from "./admin-auth.js";

/**
 * Tenant scope derived from an admin Bearer token.
 * - `adminId`     : id of the authenticated admin (for ownerAdminId filtering)
 * - `isSuperAdmin`: rôle plateforme ; le périmètre des données (tous tenants vs
 *   un seul) dépend de chaque route (ex. liste routeurs = propriétaire JWT ;
 *   console super = endpoints `/api/super/...`).
 */
export interface AdminScope {
  adminId: number;
  isSuperAdmin: boolean;
}

/**
 * Extract the admin scope from the request, or send a 401/403 response and
 * return null. Use this at the top of any admin-only route that needs to
 * scope queries by tenant.
 *
 * The companion `verifyAdminToken(token): boolean` is preserved for the many
 * legacy routes that just need a yes/no auth check; new code should prefer
 * this helper to avoid two separate token decodes.
 */
export function requireAdminScope(req: Request, res: Response): AdminScope | null {
  const auth = req.headers.authorization;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  const claims = token ? verifyAdminTokenFull(token) : null;
  if (!claims) {
    res.status(401).json({ error: "Non authentifié" });
    return null;
  }
  return claims;
}

/**
 * Like `requireAdminScope` but additionally enforces the super-admin role.
 * Used to gate the /api/super/** endpoints.
 */
export function requireSuperAdminScope(req: Request, res: Response): AdminScope | null {
  const scope = requireAdminScope(req, res);
  if (!scope) return null;
  if (!scope.isSuperAdmin) {
    res.status(403).json({ error: "Réservé au super administrateur" });
    return null;
  }
  return scope;
}
