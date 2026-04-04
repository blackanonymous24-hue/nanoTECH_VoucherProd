import { eq, and, inArray, sql } from "drizzle-orm";
import { db, routersTable, vouchersTable } from "@workspace/db";
import { listHotspotUsers, listProfiles, type RouterConnection } from "./mikrotik.js";
import { runUsageSync } from "./usage-sync.js";
import { syncScriptCache, getCachedSalesByBatch } from "./script-cache.js";
import { logger } from "./logger.js";

/** Throttle: don't sync the same vendor more than once every 2 minutes */
const SYNC_TTL = 2 * 60_000;
const lastSyncAt = new Map<number, number>();

/**
 * Step 3 of vendor sync — reads historical sales from the LOCAL SCRIPT CACHE
 * (no MikroTik call) and creates DB records for vouchers that:
 *   - Match the vendor's commentSuffix (batch field ends with suffix)
 *   - Are NOT already in the local vouchers table (sold before VoucherNet)
 *
 * This is the only way to recover old sales where the hotspot user was already
 * deleted from MikroTik (sold vouchers disappear from /ip/hotspot/user).
 * Using the cache makes this a fast local DB query instead of a 90s remote call.
 */
async function syncHistoricalScriptSalesToVendor(
  vendorId: number,
  routerId: number,
  suffixes: string[],
): Promise<{ created: number; reattributed: number }> {
  let created = 0;
  let reattributed = 0;

  try {
    // Read from local cache — instant DB query, no MikroTik call
    const matched = await getCachedSalesByBatch(routerId, suffixes);
    if (matched.length === 0) return { created, reattributed };

    // Fetch existing voucher records for this router
    const existing = await db
      .select({ username: vouchersTable.username, id: vouchersTable.id, vendorId: vouchersTable.vendorId })
      .from(vouchersTable)
      .where(eq(vouchersTable.routerId, routerId));

    const existingMap = new Map<string, { username: string; id: number; vendorId: number | null }>(
      existing.map((e) => [e.username.toLowerCase(), e]),
    );

    const toInsert: (typeof vouchersTable.$inferInsert)[] = [];
    const toReattribute: number[] = [];

    for (const entry of matched) {
      const key = entry.username.toLowerCase();
      const found = existingMap.get(key);

      if (!found) {
        if (isNaN(entry.saleDate.getTime())) continue;

        toInsert.push({
          routerId,
          vendorId,
          username:    entry.username,
          password:    "",
          profileName: entry.label || "",
          price:       entry.price || "",
          validity:    entry.validity || "",
          comment:     entry.batch || null,
          usedAt:      entry.saleDate,
          printedAt:   entry.saleDate,
          salePrice:   entry.price || null,
          macAddress:  entry.mac   || null,
          saleIp:      entry.ip    || null,
        });
      } else if (found.vendorId !== vendorId) {
        toReattribute.push(found.id);
      }
    }

    // Insert missing historical vouchers in chunks
    const CHUNK = 100;
    for (let i = 0; i < toInsert.length; i += CHUNK) {
      await db.insert(vouchersTable).values(toInsert.slice(i, i + CHUNK)).onConflictDoNothing();
      created += Math.min(CHUNK, toInsert.length - i);
    }

    // Re-attribute wrongly-assigned vouchers
    for (let i = 0; i < toReattribute.length; i += 200) {
      await db
        .update(vouchersTable)
        .set({ vendorId })
        .where(inArray(vouchersTable.id, toReattribute.slice(i, i + 200)));
      reattributed += Math.min(200, toReattribute.length - i);
    }

    logger.info({ vendorId, routerId, matched: matched.length, created, reattributed },
      "vendor sync: historical script sales backfill complete");
  } catch (err) {
    logger.warn({ vendorId, routerId, err }, "vendor sync: historical script sales backfill failed (non-blocking)");
  }

  return { created, reattributed };
}

/**
 * Full vendor sync pipeline:
 *  1. Refresh local script cache (incremental — only current + last month)
 *  2. Import current hotspot users from MikroTik (active/unsold vouchers)
 *  3. Re-attribute existing DB vouchers by comment suffix
 *  4. Backfill historical sales from cache (sold/deleted vouchers)
 *  5. Populate usedAt dates from cache for all vendor vouchers
 */
export async function syncMikrotikUsersToVendor(
  vendorId: number,
  routerId: number,
  suffixes: string[],
  force = false,
): Promise<void> {
  const activeSuffixes = suffixes.filter(Boolean);
  if (activeSuffixes.length === 0) return;

  const last = lastSyncAt.get(vendorId) ?? 0;
  if (!force && Date.now() - last < SYNC_TTL) return; // throttled

  lastSyncAt.set(vendorId, Date.now());

  try {
    const [router] = await db
      .select()
      .from(routersTable)
      .where(eq(routersTable.id, routerId));
    if (!router) return;

    const conn: RouterConnection = {
      host:     router.host,
      port:     router.port,
      username: router.username,
      password: router.password,
    };

    // ── Step 1: refresh script cache (incremental) ────────────────────────
    await syncScriptCache(routerId, conn);

    // ── Step 2: import currently active hotspot users ─────────────────────
    const [allUsers, allProfiles] = await Promise.all([
      listHotspotUsers(conn, 20_000),
      listProfiles(conn).catch(() => []),
    ]);

    const matched = allUsers.filter(
      (u) => u.comment && activeSuffixes.some((s) => u.comment!.endsWith(s)),
    );

    // Query existing vouchers by comment suffix
    const suffixConditions = activeSuffixes.map((s) => sql`${vouchersTable.comment} LIKE ${"%" + s}`);
    const existingRows = await db
      .select({ username: vouchersTable.username, vendorId: vouchersTable.vendorId, id: vouchersTable.id })
      .from(vouchersTable)
      .where(and(
        eq(vouchersTable.routerId, routerId),
        sql`(${sql.join(suffixConditions, sql` OR `)})`,
      ));

    type ExRow = { username: string; vendorId: number | null; id: number };
    const existingMap = new Map<string, ExRow>(existingRows.map((e: ExRow) => [e.username, e]));

    // ── Step 3: re-attribute existing DB vouchers ─────────────────────────
    const toUpdate = existingRows
      .filter((e: ExRow) => e.vendorId !== vendorId)
      .map((e: ExRow) => e.id);
    if (toUpdate.length > 0) {
      const CHUNK = 200;
      for (let i = 0; i < toUpdate.length; i += CHUNK) {
        await db
          .update(vouchersTable)
          .set({ vendorId })
          .where(inArray(vouchersTable.id, toUpdate.slice(i, i + CHUNK)));
      }
      logger.info({ vendorId, routerId, count: toUpdate.length }, "vendor sync: updated vendorId on existing vouchers");
    }

    // Insert active hotspot users not yet in DB
    const profileMap = new Map(allProfiles.map((p) => [p.name, p]));
    // Build a case-insensitive lookup map for profile name normalization
    // so "3-Heures" (user field) maps to "3-Heure" (canonical MikroTik profile name).
    const profileNamesLower = new Map(allProfiles.map((p) => [p.name.toLowerCase(), p.name]));

    const toInsert = matched
      .filter((u) => !existingMap.has(u.username) && u.username)
      .map((u) => {
        // Normalize profile name: prefer exact match, then case-insensitive, then original
        const rawProfile = u.profile || "default";
        const canonicalName =
          profileMap.has(rawProfile)
            ? rawProfile
            : (profileNamesLower.get(rawProfile.toLowerCase()) ?? rawProfile);
        const prof = profileMap.get(canonicalName);
        return {
          routerId,
          vendorId,
          username:    u.username,
          password:    u.password ?? "",
          profileName: canonicalName,
          price:       prof?.price ?? "",
          validity:    prof?.validity ?? "",
          comment:     u.comment ?? null,
        };
      });

    if (toInsert.length > 0) {
      const CHUNK = 100;
      let inserted = 0;
      for (let i = 0; i < toInsert.length; i += CHUNK) {
        const chunk = toInsert.slice(i, i + CHUNK);
        await db.insert(vouchersTable).values(chunk).onConflictDoNothing();
        inserted += chunk.length;
      }
      logger.info({ vendorId, routerId, count: inserted }, "vendor sync: inserted new vouchers from MikroTik");
    }

    // ── Step 4: backfill historical sales from cache ──────────────────────
    await syncHistoricalScriptSalesToVendor(vendorId, routerId, activeSuffixes);

    // ── Step 5: populate/correct usedAt dates from cache ─────────────────
    try {
      const syncResult = await runUsageSync(routerId, conn, vendorId);
      logger.info({ vendorId, routerId, ...syncResult }, "vendor sync: usage backfill complete");
    } catch (syncErr) {
      logger.warn({ vendorId, routerId, err: syncErr }, "vendor sync: usage backfill failed (non-blocking)");
    }
  } catch (err) {
    lastSyncAt.delete(vendorId); // reset on error so next call retries
    logger.warn({ vendorId, routerId, err }, "vendor sync: failed (non-blocking)");
  }
}
