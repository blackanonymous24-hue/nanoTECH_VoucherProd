/**
 * On server startup, try to fetch profiles for every router and persist
 * them to the DB snapshot table. This ensures the snapshot is up-to-date
 * after a restart, so even offline routers serve their last known profiles.
 */
import { db, routersTable, routerProfilesSnapshotTable } from "@workspace/db";
import { listProfiles } from "./mikrotik.js";
import { logger } from "./logger.js";

export async function warmProfileSnapshots(): Promise<void> {
  try {
    const routers = await db.select().from(routersTable);
    await Promise.allSettled(
      routers.map(async (r) => {
        try {
          const conn = { host: r.host, port: r.port, username: r.username, password: r.password };
          const profiles = await listProfiles(conn);
          if (!profiles.length) return;
          await db.insert(routerProfilesSnapshotTable)
            .values({ routerId: r.id, profilesJson: JSON.stringify(profiles) })
            .onConflictDoUpdate({
              target: routerProfilesSnapshotTable.routerId,
              set: { profilesJson: JSON.stringify(profiles), updatedAt: new Date() },
            });
          logger.info({ routerId: r.id, count: profiles.length }, "profiles: snapshot saved");
        } catch {
          // Router offline — snapshot not updated, old one still available.
        }
      }),
    );
  } catch (err) {
    logger.warn({ err }, "profiles: warm snapshot failed (non-blocking)");
  }
}
