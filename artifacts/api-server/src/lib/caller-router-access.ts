import type { Response } from "express";
import { eq } from "drizzle-orm";
import { db, routersTable, vouchersTable } from "@workspace/db";
import type { CallerScope } from "../routes/routers.js";

/**
 * Vérifie que le scope courant peut accéder au routeur `routerId`.
 * Écrit 400/403/404 sur `res` et retourne false si refusé.
 */
export async function assertRouterAccessForScope(
  scope: CallerScope,
  routerId: number,
  res: Response,
): Promise<boolean> {
  if (!Number.isFinite(routerId) || routerId <= 0) {
    res.status(400).json({ error: "routerId invalide" });
    return false;
  }

  if (scope.kind === "super") {
    const [r] = await db
      .select({ id: routersTable.id })
      .from(routersTable)
      .where(eq(routersTable.id, routerId));
    if (!r) {
      res.status(404).json({ error: "Routeur introuvable" });
      return false;
    }
    return true;
  }

  if (scope.kind === "admin") {
    const [r] = await db
      .select({ owner: routersTable.ownerAdminId })
      .from(routersTable)
      .where(eq(routersTable.id, routerId));
    if (!r) {
      res.status(404).json({ error: "Routeur introuvable" });
      return false;
    }
    if (r.owner == null || r.owner !== scope.adminId) {
      res.status(403).json({ error: "Accès refusé à ce routeur" });
      return false;
    }
    return true;
  }

  if (!scope.routerIds.includes(routerId)) {
    res.status(403).json({ error: "Accès refusé à ce routeur" });
    return false;
  }
  return true;
}

/** Charge un voucher et vérifie que le scope peut accéder à son routeur. */
export async function assertVoucherAccessForScope(
  scope: CallerScope,
  voucherId: number,
  res: Response,
): Promise<{ routerId: number } | null> {
  const [row] = await db
    .select({ routerId: vouchersTable.routerId })
    .from(vouchersTable)
    .where(eq(vouchersTable.id, voucherId));
  if (!row) {
    res.status(404).json({ error: "Voucher introuvable" });
    return null;
  }
  if (!(await assertRouterAccessForScope(scope, row.routerId, res))) return null;
  return { routerId: row.routerId };
}
