import { eq, and, inArray, isNull } from "drizzle-orm";
import { db, routersTable, vouchersTable } from "@workspace/db";
import { listHotspotUsers, listProfiles } from "./mikrotik.js";
import { logger } from "./logger.js";

/**
 * Sync MikroTik hotspot users matching the vendor's comment suffixes
 * into the local vouchers table.
 *
 * - MikroTik users not in local DB → inserted with vendorId set
 * - MikroTik users already in local DB but vendorId=null → vendorId updated
 *
 * Safe to call frequently: idempotent, non-blocking errors.
 */
export async function syncMikrotikUsersToVendor(
  vendorId: number,
  routerId: number,
  suffixes: string[],
): Promise<void> {
  const activeSuffixes = suffixes.filter(Boolean);
  if (activeSuffixes.length === 0) return;

  try {
    const [router] = await db
      .select()
      .from(routersTable)
      .where(eq(routersTable.id, routerId));
    if (!router) return;

    const conn = {
      host: router.host,
      port: router.port,
      username: router.username,
      password: router.password,
    };

    const [allUsers, allProfiles] = await Promise.all([
      listHotspotUsers(conn, 20_000),
      listProfiles(conn).catch(() => []),
    ]);

    const matched = allUsers.filter(
      (u) => u.comment && activeSuffixes.some((s) => u.comment!.endsWith(s)),
    );
    if (matched.length === 0) return;

    const matchedUsernames = matched.map((u) => u.username);

    const existing = await db
      .select({ username: vouchersTable.username, vendorId: vouchersTable.vendorId, id: vouchersTable.id })
      .from(vouchersTable)
      .where(and(eq(vouchersTable.routerId, routerId), inArray(vouchersTable.username, matchedUsernames)));

    const existingMap = new Map(existing.map((e) => [e.username, e]));

    const toUpdate = existing.filter((e) => e.vendorId === null).map((e) => e.id);
    if (toUpdate.length > 0) {
      await db
        .update(vouchersTable)
        .set({ vendorId })
        .where(and(inArray(vouchersTable.id, toUpdate), isNull(vouchersTable.vendorId)));
      logger.info({ vendorId, routerId, count: toUpdate.length }, "vendor sync: updated vendorId on existing vouchers");
    }

    const profileMap = new Map(allProfiles.map((p) => [p.name, p]));
    const toInsert = matched.filter((u) => !existingMap.has(u.username));
    if (toInsert.length > 0) {
      await db.insert(vouchersTable).values(
        toInsert.map((u) => {
          const prof = profileMap.get(u.profile);
          return {
            routerId,
            vendorId,
            username: u.username,
            password: u.password,
            profileName: u.profile,
            price: prof?.price ?? "",
            validity: prof?.validity ?? "",
            comment: u.comment ?? null,
          };
        }),
      ).onConflictDoNothing();
      logger.info({ vendorId, routerId, count: toInsert.length }, "vendor sync: inserted new vouchers from MikroTik");
    }
  } catch (err) {
    logger.warn({ vendorId, routerId, err }, "vendor sync: failed (non-blocking)");
  }
}
