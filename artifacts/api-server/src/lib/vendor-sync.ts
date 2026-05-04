import { eq, and, inArray, isNull, sql } from "drizzle-orm";
import { db, routersTable, vouchersTable, vendorsTable, profilesCacheTable } from "@workspace/db";
import { listHotspotUsers, listProfiles, type RouterConnection } from "./mikrotik.js";
import { runUsageSync } from "./usage-sync.js";
import { syncScriptCache, getCachedSalesByBatch, clearRouterScriptCache } from "./script-cache.js";
import { logger } from "./logger.js";
import { isRouterLocked } from "./router-lock.js";

/** Throttle: don't sync the same vendor more than once every 2 minutes */
const SYNC_TTL = 2 * 60_000;
const lastSyncAt = new Map<number, number>();
let realtimeTimer: ReturnType<typeof setInterval> | null = null;
let realtimeRunning = false;

/** Optional callback fired after each vendor sync completes (e.g. to invalidate caches). */
let _onVendorSyncComplete: ((vendorId: number) => void) | null = null;
export function setOnVendorSyncComplete(cb: (vendorId: number) => void): void {
  _onVendorSyncComplete = cb;
}

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
      .select({ username: vouchersTable.username, id: vouchersTable.id, vendorId: vouchersTable.vendorId, printedAt: vouchersTable.printedAt, price: vouchersTable.price })
      .from(vouchersTable)
      .where(eq(vouchersTable.routerId, routerId));

    const existingMap = new Map<string, { username: string; id: number; vendorId: number | null; printedAt: Date | null; price: string | null }>(
      existing.map((e) => [e.username.toLowerCase(), e]),
    );

    const toInsert: (typeof vouchersTable.$inferInsert)[] = [];
    const toReattribute: number[] = [];
    const toFix: { id: number; printedAt: Date; usedAt: Date; price: string; salePrice: string | null }[] = [];
    const toPriceUpdate: { id: number; price: string; salePrice: string | null }[] = [];

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
      } else if (found.printedAt === null && !isNaN(entry.saleDate.getTime())) {
        // Ticket exists but has no printedAt — fill it from the script cache
        toFix.push({
          id:        found.id,
          printedAt: entry.saleDate,
          usedAt:    entry.saleDate,
          price:     entry.price || "",
          salePrice: entry.price || null,
        });
      } else if (found.printedAt !== null && (!found.price || found.price === "") && entry.price) {
        // Ticket exists with printedAt but price is missing — fill price from script cache
        toPriceUpdate.push({
          id:        found.id,
          price:     entry.price,
          salePrice: entry.price,
        });
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

    // Repair vouchers that exist but are missing printedAt (previously untracked sales)
    for (const fix of toFix) {
      await db
        .update(vouchersTable)
        .set({ printedAt: fix.printedAt, usedAt: fix.usedAt, price: fix.price, salePrice: fix.salePrice })
        .where(eq(vouchersTable.id, fix.id));
      created++;
    }

    // Repair vouchers that have printedAt but are missing price (fill from script cache)
    for (const fix of toPriceUpdate) {
      await db
        .update(vouchersTable)
        .set({ price: fix.price, salePrice: fix.salePrice })
        .where(eq(vouchersTable.id, fix.id));
    }

    logger.info({ vendorId, routerId, matched: matched.length, created, reattributed, priceFixed: toPriceUpdate.length },
      "vendor sync: historical script sales backfill complete");
  } catch (err) {
    logger.warn({ vendorId, routerId, err }, "vendor sync: historical script sales backfill failed (non-blocking)");
  }

  return { created, reattributed };
}

/**
 * Detects profile renames in MikroTik by comparing the persisted mikrotikId→name
 * mapping with the current MikroTik profiles list.
 *
 * MikroTik profile .id (e.g. "*1") is IMMUTABLE even across renames.
 * When a rename is detected we bulk-update ALL vouchers (including sold ones)
 * for this router so every report, tracking view, and report page shows the
 * current name immediately.
 *
 * Should be called once per router per sync cycle, before per-vendor syncs.
 */
export async function syncProfileRenames(routerId: number, conn: RouterConnection): Promise<void> {
  try {
    const allProfiles = await listProfiles(conn).catch(() => [] as Awaited<ReturnType<typeof listProfiles>>);
    if (allProfiles.length === 0) return; // safety: don't act on an empty list (connection failure)

    // Load what we last knew for this router
    const cached = await db
      .select({ mikrotikId: profilesCacheTable.mikrotikId, profileName: profilesCacheTable.profileName })
      .from(profilesCacheTable)
      .where(eq(profilesCacheTable.routerId, routerId));

    const cacheMap = new Map(cached.map((c) => [c.mikrotikId, c.profileName]));
    const currentIds = new Set(allProfiles.map((p) => p.mikrotikId).filter(Boolean));

    const renames: Array<{ oldName: string; newName: string }> = [];
    const toUpsert: Array<{ routerId: number; mikrotikId: string; profileName: string }> = [];

    for (const p of allProfiles) {
      if (!p.mikrotikId) continue;
      const knownName = cacheMap.get(p.mikrotikId);
      if (knownName === undefined) {
        // New profile — add to cache
        toUpsert.push({ routerId, mikrotikId: p.mikrotikId, profileName: p.name });
      } else if (knownName !== p.name) {
        // Same MikroTik ID, different name → RENAME detected
        renames.push({ oldName: knownName, newName: p.name });
        toUpsert.push({ routerId, mikrotikId: p.mikrotikId, profileName: p.name });
      }
    }

    // Apply renames to ALL vouchers on this router (sold + unsold, all vendors)
    for (const { oldName, newName } of renames) {
      await db
        .update(vouchersTable)
        .set({ profileName: newName })
        .where(and(
          eq(vouchersTable.routerId, routerId),
          eq(vouchersTable.profileName, oldName),
        ));
      logger.info({ routerId, oldName, newName }, "profile-sync: renamed profile propagated to all vouchers");
    }

    // Upsert cache entries
    if (toUpsert.length > 0) {
      await db
        .insert(profilesCacheTable)
        .values(toUpsert.map((r) => ({ ...r, updatedAt: new Date() })))
        .onConflictDoUpdate({
          target: [profilesCacheTable.routerId, profilesCacheTable.mikrotikId],
          set: { profileName: sql`excluded.profile_name`, updatedAt: sql`now()` },
        });
    }

    // Remove cache entries for profiles that no longer exist in MikroTik
    for (const cached of cacheMap) {
      const [mkId] = cached;
      if (!currentIds.has(mkId)) {
        await db
          .delete(profilesCacheTable)
          .where(and(
            eq(profilesCacheTable.routerId, routerId),
            eq(profilesCacheTable.mikrotikId, mkId),
          ));
      }
    }
  } catch (err) {
    logger.warn({ routerId, err }, "profile-sync: syncProfileRenames failed (non-blocking)");
  }
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
      .select({ username: vouchersTable.username, vendorId: vouchersTable.vendorId, id: vouchersTable.id, profileName: vouchersTable.profileName })
      .from(vouchersTable)
      .where(and(
        eq(vouchersTable.routerId, routerId),
        sql`(${sql.join(suffixConditions, sql` OR `)})`,
      ));

    type ExRow = { username: string; vendorId: number | null; id: number; profileName: string };
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

    // Build profile lookup maps — used in Steps 3a, 3b, 3c and the insert step
    const profileMap = new Map(allProfiles.map((p) => [p.name, p]));
    const profileNamesLower = new Map(allProfiles.map((p) => [p.name.toLowerCase(), p.name]));

    // ── Step 3a: auto-correct profile names using MikroTik live data ──────
    // MikroTik internally links hotspot users to profiles by an immutable .id.
    // When a profile is renamed, the /ip/hotspot/user list reflects the NEW
    // name immediately for all existing users (MikroTik updates them via .id).
    // We compare each active username's MikroTik profile against what's in
    // the DB — any mismatch means a rename occurred → correct automatically.
    const profileFixes = new Map<string, number[]>(); // canonicalName → [ids]
    for (const u of matched) {
      const existing = existingMap.get(u.username);
      if (!existing) continue; // new user — will be inserted below

      const rawProfile = u.profile || "default";
      const canonical = profileMap.has(rawProfile)
        ? rawProfile
        : (profileNamesLower.get(rawProfile.toLowerCase()) ?? rawProfile);

      if (existing.profileName !== canonical) {
        if (!profileFixes.has(canonical)) profileFixes.set(canonical, []);
        profileFixes.get(canonical)!.push(existing.id);
      }
    }

    if (profileFixes.size > 0) {
      for (const [canonical, ids] of profileFixes) {
        const CHUNK = 200;
        for (let i = 0; i < ids.length; i += CHUNK) {
          await db
            .update(vouchersTable)
            .set({ profileName: canonical })
            .where(inArray(vouchersTable.id, ids.slice(i, i + CHUNK)));
        }
        logger.info({ vendorId, routerId, count: ids.length, canonical },
          "vendor sync: auto-corrected profile name (MikroTik rename detected)");
      }
    }

    // ── Step 3b: normalize profile names on existing vendor vouchers ──────
    // When a profile is renamed in MikroTik (e.g. "3-Heures" → "3-Heure"),
    // DB records from before the rename still carry the old name. Here we
    // detect those via a case-insensitive lookup and update them in bulk.
    if (allProfiles.length > 0) {
      const vendorProfileRows = await db
        .select({ id: vouchersTable.id, profileName: vouchersTable.profileName })
        .from(vouchersTable)
        .where(eq(vouchersTable.vendorId, vendorId));

      const toNormalize = new Map<string, number[]>(); // canonicalName → [ids]
      for (const v of vendorProfileRows) {
        if (!profileMap.has(v.profileName)) {
          const canonical = profileNamesLower.get(v.profileName.toLowerCase());
          if (canonical) {
            if (!toNormalize.has(canonical)) toNormalize.set(canonical, []);
            toNormalize.get(canonical)!.push(v.id);
          }
        }
      }

      for (const [canonical, ids] of toNormalize) {
        const CHUNK = 200;
        for (let i = 0; i < ids.length; i += CHUNK) {
          await db
            .update(vouchersTable)
            .set({ profileName: canonical })
            .where(inArray(vouchersTable.id, ids.slice(i, i + CHUNK)));
        }
        logger.info({ vendorId, routerId, count: ids.length, canonical },
          "vendor sync: renamed obsolete profile → canonical");
      }

      // ── Step 3c: delete unsold vouchers whose profile no longer exists ────
      // If a profile was deleted in MikroTik (not renamed — renaming was
      // handled above), any unsold/available tickets for that profile are now
      // invalid. We purge them from the DB. Sold records (usedAt IS NOT NULL)
      // are kept as permanent accounting history.
      // Safety guard: only run when MikroTik returned at least one profile,
      // so a connection failure does not wipe the DB.
      const orphanedUnsold = vendorProfileRows.filter((v) => {
        // Already handled by rename step if a canonical match exists
        if (profileMap.has(v.profileName)) return false;
        if (profileNamesLower.has(v.profileName.toLowerCase())) return false;
        return true; // profile truly absent from MikroTik
      });

      if (orphanedUnsold.length > 0) {
        const orphanIds = orphanedUnsold.map((v) => v.id);
        // Only delete the unsold ones (preserve sold history)
        const CHUNK = 200;
        let deleted = 0;
        for (let i = 0; i < orphanIds.length; i += CHUNK) {
          const rows = await db
            .delete(vouchersTable)
            .where(and(
              inArray(vouchersTable.id, orphanIds.slice(i, i + CHUNK)),
              isNull(vouchersTable.usedAt),
            ))
            .returning({ id: vouchersTable.id });
          deleted += rows.length;
        }
        if (deleted > 0) {
          const deletedProfiles = [...new Set(orphanedUnsold.map((v) => v.profileName))];
          logger.info({ vendorId, routerId, deleted, profiles: deletedProfiles },
            "vendor sync: purged unsold vouchers for deleted MikroTik profiles");
        }
      }
    }

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

    // ── Step 6: purge unsold vouchers absent from MikroTik ───────────────
    // After step 5, any voucher still with usedAt IS NULL that doesn't appear
    // on MikroTik was admin-deleted without going through a sale.
    // Safety guard: only run when MikroTik returned at least 1 user total
    // (avoids wiping DB if the connection returned an empty list silently).
    if (allUsers.length > 0) {
      const matchedUsernames = new Set(matched.map((u) => u.username.toLowerCase()));

      // Re-query unsold vouchers after step 5 so usedAt is up-to-date
      const suffixConds = activeSuffixes.map((s) => sql`${vouchersTable.comment} LIKE ${"%" + s}`);
      const unsoldInDb = await db
        .select({ id: vouchersTable.id, username: vouchersTable.username })
        .from(vouchersTable)
        .where(and(
          eq(vouchersTable.vendorId, vendorId),
          eq(vouchersTable.routerId, routerId),
          isNull(vouchersTable.usedAt),
          sql`(${sql.join(suffixConds, sql` OR `)})`,
        ));

      const toPurge = unsoldInDb.filter((v) => !matchedUsernames.has(v.username.toLowerCase()));

      if (toPurge.length > 0) {
        const CHUNK = 200;
        let deleted = 0;
        for (let i = 0; i < toPurge.length; i += CHUNK) {
          const rows = await db
            .delete(vouchersTable)
            .where(inArray(vouchersTable.id, toPurge.slice(i, i + CHUNK).map((v) => v.id)))
            .returning({ id: vouchersTable.id });
          deleted += rows.length;
        }
        if (deleted > 0) {
          logger.info({ vendorId, routerId, deleted }, "vendor sync: purged unsold vouchers absent from MikroTik");
        }
      }
    }
  } catch (err) {
    lastSyncAt.delete(vendorId); // reset on error so next call retries
    logger.warn({ vendorId, routerId, err }, "vendor sync: failed (non-blocking)");
  }
}

/**
 * Purges unsold DB vouchers (usedAt IS NULL) whose username is NOT present
 * in the live MikroTik hotspot user list for the given router.
 *
 * Safety guards:
 *  - Skips entirely if MikroTik returns 0 users (router unreachable / empty)
 *  - Only touches vouchers with usedAt IS NULL (never modifies sold records)
 *  - Deletes in chunks of 200 to avoid large IN clauses
 */
export async function purgePhantomVouchers(routerId: number): Promise<{
  routerId: number;
  routerHost: string;
  skipped: boolean;
  reason?: string;
  activeUsersCount: number;
  unsoldInDb: number;
  deleted: number;
}> {
  const [router] = await db.select().from(routersTable).where(eq(routersTable.id, routerId));
  if (!router) {
    return { routerId, routerHost: "unknown", skipped: true, reason: "Routeur introuvable", activeUsersCount: 0, unsoldInDb: 0, deleted: 0 };
  }

  const conn: RouterConnection = { host: router.host, port: router.port, username: router.username, password: router.password };

  let allUsers: Awaited<ReturnType<typeof listHotspotUsers>>;
  try {
    allUsers = await listHotspotUsers(conn, 30_000);
  } catch (err) {
    logger.warn({ routerId, err }, "purge-phantoms: impossible de joindre MikroTik — ignoré");
    return { routerId, routerHost: router.host, skipped: true, reason: "Connexion MikroTik échouée", activeUsersCount: 0, unsoldInDb: 0, deleted: 0 };
  }

  if (allUsers.length === 0) {
    logger.warn({ routerId }, "purge-phantoms: MikroTik a retourné 0 users — garde de sécurité activée");
    return { routerId, routerHost: router.host, skipped: true, reason: "MikroTik a retourné 0 utilisateurs (garde de sécurité)", activeUsersCount: 0, unsoldInDb: 0, deleted: 0 };
  }

  const activeUsernames = new Set(allUsers.map((u) => u.username.toLowerCase()));

  const unsoldRows = await db
    .select({ id: vouchersTable.id, username: vouchersTable.username })
    .from(vouchersTable)
    .where(and(eq(vouchersTable.routerId, routerId), isNull(vouchersTable.usedAt)));

  const phantomIds = unsoldRows
    .filter((v) => !activeUsernames.has(v.username.toLowerCase()))
    .map((v) => v.id);

  if (phantomIds.length === 0) {
    logger.info({ routerId, activeUsersCount: allUsers.length, unsoldInDb: unsoldRows.length }, "purge-phantoms: aucun fantôme trouvé");
    return { routerId, routerHost: router.host, skipped: false, activeUsersCount: allUsers.length, unsoldInDb: unsoldRows.length, deleted: 0 };
  }

  const CHUNK = 200;
  let deleted = 0;
  for (let i = 0; i < phantomIds.length; i += CHUNK) {
    const rows = await db
      .delete(vouchersTable)
      .where(inArray(vouchersTable.id, phantomIds.slice(i, i + CHUNK)))
      .returning({ id: vouchersTable.id });
    deleted += rows.length;
  }

  logger.info({ routerId, activeUsersCount: allUsers.length, unsoldInDb: unsoldRows.length, deleted }, "purge-phantoms: vouchers fantômes supprimés");
  return { routerId, routerHost: router.host, skipped: false, activeUsersCount: allUsers.length, unsoldInDb: unsoldRows.length, deleted };
}

/**
 * Forces a complete resync for a specific router:
 *  1. Clears the in-memory script-cache flag → next call does a FULL reload
 *  2. Fetches ALL scripts fresh from MikroTik (heavy, one-time)
 *  3. Runs the historical backfill for every active vendor on this router
 *
 * Used by the admin "force-sync" endpoint to recover from missed-ticket scenarios
 * caused by router timeouts or connection gaps.
 */
export async function forceRouterFullSync(routerId: number): Promise<{
  scriptInserted: number;
  vendorsProcessed: number;
  vouchersCreated: number;
}> {
  const [router] = await db.select().from(routersTable).where(eq(routersTable.id, routerId));
  if (!router) throw new Error(`Routeur ${routerId} introuvable`);

  const conn: RouterConnection = {
    host: router.host, port: router.port,
    username: router.username, password: router.password,
  };

  // 1. Clear cache flag → forces full reload
  clearRouterScriptCache(routerId);

  // Also reset vendor throttle for all vendors on this router so they re-sync immediately
  const vendors = await db
    .select({
      id: vendorsTable.id,
      commentSuffix: vendorsTable.commentSuffix,
      commentSuffix2: vendorsTable.commentSuffix2,
      isActive: vendorsTable.isActive,
    })
    .from(vendorsTable)
    .where(eq(vendorsTable.routerId, routerId));

  for (const v of vendors) lastSyncAt.delete(v.id);

  // 2. Full script cache reload (blocking — this is intentional for admin action)
  const scriptInserted = await syncScriptCache(routerId, conn);
  logger.info({ routerId, scriptInserted }, "force-sync: script cache refreshed");

  // 3. Historical backfill for every active vendor on this router
  let vouchersCreated = 0;
  const activeVendors = vendors.filter((v) => v.isActive);
  for (const v of activeVendors) {
    const suffixes = [v.commentSuffix, v.commentSuffix2].filter(Boolean) as string[];
    if (suffixes.length === 0) continue;
    const { created } = await syncHistoricalScriptSalesToVendor(v.id, routerId, suffixes);
    vouchersCreated += created;
  }

  logger.info({ routerId, vendorsProcessed: activeVendors.length, vouchersCreated },
    "force-sync: complete");

  return { scriptInserted, vendorsProcessed: activeVendors.length, vouchersCreated };
}

/**
 * Starts a background periodic sync loop for all active vendors.
 * This keeps sale date/IP/MAC updates flowing without user interaction.
 */
export function startRealtimeVendorSync(): void {
  if (realtimeTimer) return;

  const intervalMs = Math.max(5_000, parseInt(process.env.VENDOR_SYNC_INTERVAL_MS ?? "10000", 10) || 10000);

  const tick = async () => {
    if (realtimeRunning) return;
    realtimeRunning = true;
    try {
      const [vendors, routers] = await Promise.all([
        db.select({
          id: vendorsTable.id,
          routerId: vendorsTable.routerId,
          commentSuffix: vendorsTable.commentSuffix,
          commentSuffix2: vendorsTable.commentSuffix2,
          isActive: vendorsTable.isActive,
        }).from(vendorsTable),
        db.select().from(routersTable),
      ]);

      // ── Phase 1: sync profile renames once per router ──────────────────
      // Must run before per-vendor syncs so vendor stats already reflect new names.
      // Skip routers that are locked by an active user operation (e.g. generation).
      const activeRouterIds = new Set(
        vendors.filter((v) => v.isActive && v.routerId).map((v) => v.routerId!),
      );
      await Promise.allSettled(
        routers
          .filter((r) => activeRouterIds.has(r.id) && !isRouterLocked(r.id))
          .map((r) => {
            const conn = { host: r.host, port: r.port, username: r.username, password: r.password };
            return syncProfileRenames(r.id, conn);
          }),
      );

      // ── Phase 2: per-vendor sync (hotspot users, history, usage) ───────
      // Group vendors by routerId so vendors sharing the same router are processed
      // sequentially — avoids opening multiple API connections to the same MikroTik
      // router simultaneously (which saturates the connection limit and blocks
      // concurrent operations like voucher generation).
      // Vendors on *different* routers still run in parallel.
      const active = vendors.filter((v) => v.isActive && v.routerId);
      const byRouter = new Map<number, typeof active>();
      for (const v of active) {
        const rid = v.routerId!;
        if (!byRouter.has(rid)) byRouter.set(rid, []);
        byRouter.get(rid)!.push(v);
      }
      await Promise.allSettled(
        Array.from(byRouter.values()).map(async (group) => {
          for (const v of group) {
            // Skip if an active user operation (e.g. voucher generation) has locked this router
            if (isRouterLocked(v.routerId!)) continue;
            const suffixes = [v.commentSuffix, v.commentSuffix2].filter(Boolean) as string[];
            if (suffixes.length === 0) continue;
            try {
              await syncMikrotikUsersToVendor(v.id, v.routerId!, suffixes, true);
              // Notify listeners so they can invalidate stale caches (e.g. vendor portal)
              try { _onVendorSyncComplete?.(v.id); } catch (_) { /* ignore */ }
            } catch { /* keep going for next vendor in this router group */ }
          }
        }),
      );
    } catch (err) {
      logger.warn({ err }, "realtime vendor sync tick failed");
    } finally {
      realtimeRunning = false;
    }
  };

  // Run once shortly after boot, then periodically.
  setTimeout(() => { void tick(); }, 3000);
  realtimeTimer = setInterval(() => { void tick(); }, intervalMs);
  logger.info({ intervalMs }, "realtime vendor sync started");
}
