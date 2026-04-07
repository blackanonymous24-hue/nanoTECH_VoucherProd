import { eq, and, isNotNull, inArray, sql } from "drizzle-orm";
import { db, vouchersTable } from "@workspace/db";
import { fetchUsedUsernames, type RouterConnection } from "./mikrotik.js";
import { getCachedSaleDetails, type CachedSaleDetail } from "./script-cache.js";
import { logger } from "./logger.js";

/**
 * Reads MikHMon sale details from the LOCAL SCRIPT CACHE (not MikroTik directly)
 * and populates/corrects `usedAt`, `salePrice`, `macAddress`, `saleIp` for all
 * vendor vouchers on a router.
 *
 * Pass 1 – mark newly-used vouchers (usedAt IS NULL).
 * Pass 2 – correct already-synced vouchers whose date differs by > 1 day.
 *
 * Can be scoped to a single vendor (vendorId) or all vendors on the router.
 *
 * NOTE: syncScriptCache() must be called before this function in the sync
 * pipeline so the cache is up-to-date.
 */
export async function runUsageSync(
  routerId: number,
  conn: RouterConnection,
  vendorId?: number,
): Promise<{ updated: number; total: number }> {
  // Use local cache — fast DB query instead of MikroTik API call
  const [saleDetails, loggedInUsernames] = await Promise.all([
    getCachedSaleDetails(routerId),
    fetchUsedUsernames(conn).catch(() => new Set<string>()),
  ]);

  const allUsed = new Set<string>([...saleDetails.keys(), ...loggedInUsernames]);

  const baseWhere = and(
    eq(vouchersTable.routerId, routerId),
    isNotNull(vouchersTable.vendorId),
    vendorId !== undefined ? eq(vouchersTable.vendorId, vendorId) : undefined,
  );

  const vouchers = await db
    .select({
      id: vouchersTable.id,
      username: vouchersTable.username,
      usedAt: vouchersTable.usedAt,
      salePrice: vouchersTable.salePrice,
      macAddress: vouchersTable.macAddress,
      saleIp: vouchersTable.saleIp,
    })
    .from(vouchersTable)
    .where(baseWhere);

  const total = vouchers.length;
  if (allUsed.size === 0) return { updated: 0, total };

  const fallbackNow = new Date();
  let updated = 0;

  // ── Pass 1: mark newly-used vouchers (usedAt IS NULL) ──────────────────
  const newlyUsed = vouchers.filter(
    (v) => v.usedAt === null && allUsed.has(v.username.toLowerCase()),
  );

  const newWithDetails    = newlyUsed.filter((v) => saleDetails.has(v.username.toLowerCase()));
  const newWithoutDetails = newlyUsed.filter((v) => !saleDetails.has(v.username.toLowerCase()));

  for (const v of newWithDetails) {
    const detail = saleDetails.get(v.username.toLowerCase())!;
    const usedAt = detail.saleDate;
    await db
      .update(vouchersTable)
      .set({
        usedAt,
        printedAt:  sql`coalesce(${vouchersTable.printedAt}, ${usedAt.toISOString()})`,
        salePrice:  detail.salePrice || null,
        macAddress: detail.mac || null,
        saleIp:     detail.ip  || null,
      })
      .where(inArray(vouchersTable.id, [v.id]));
    updated++;
  }

  if (newWithoutDetails.length > 0) {
    await db
      .update(vouchersTable)
      .set({ usedAt: fallbackNow })
      .where(inArray(vouchersTable.id, newWithoutDetails.map((v) => v.id)));
    updated += newWithoutDetails.length;
  }

  // ── Pass 2: fix already-synced vouchers with wrong usedAt/network fields ─
  // Keep this threshold low so temporary fallback dates (sync-time based)
  // are quickly replaced by the real MikroTik sale timestamp from script cache.
  const alreadySynced = vouchers.filter(
    (v) => v.usedAt !== null && saleDetails.has(v.username.toLowerCase()),
  );

  for (const v of alreadySynced) {
    const detail = saleDetails.get(v.username.toLowerCase())!;
    const scriptDate = detail.saleDate;
    const storedDate = v.usedAt as Date;
    const diffMs = Math.abs(scriptDate.getTime() - storedDate.getTime());
    const salePriceChanged = (v.salePrice ?? "") !== (detail.salePrice || "");
    const macChanged = (v.macAddress ?? "") !== (detail.mac || "");
    const ipChanged = (v.saleIp ?? "") !== (detail.ip || "");
    if (diffMs > 60_000 || salePriceChanged || macChanged || ipChanged) {
      await db
        .update(vouchersTable)
        .set({
          usedAt:     scriptDate,
          salePrice:  detail.salePrice || null,
          macAddress: detail.mac || null,
          saleIp:     detail.ip  || null,
        })
        .where(inArray(vouchersTable.id, [v.id]));
      updated++;
    }
  }

  logger.info({ routerId, vendorId, updated, total }, "usage sync complete");
  return { updated, total };
}
