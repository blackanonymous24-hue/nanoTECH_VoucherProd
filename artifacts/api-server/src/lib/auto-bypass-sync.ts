import { db, routersTable } from "@workspace/db";
import { listHotspotUsers, listIpBindings, listProfiles, updateIpBinding, type RouterConnection } from "./mikrotik.js";
import { parseRouterDurationToMs } from "./router-duration.js";
import { logger } from "./logger.js";

const DEFAULT_INTERVAL_MS = 30_000;
let timer: NodeJS.Timeout | null = null;

function stripStructuralSuffixes(comment: string): string {
  return comment
    .replace(/\s*\[vnetexp:[^\]]+\]\s*/g, "")
    .replace(/\s*\[vnetbp:[^\]]+\]\s*/g, "")
    .trim();
}

function extractVnetbpProfile(comment: string | null | undefined): string | null {
  if (!comment) return null;
  const m = comment.match(/\[vnetbp:([^\]]+)\]/);
  return m?.[1]?.trim() ? m[1].trim() : null;
}

function extractVnetexpIso(comment: string | null | undefined): string | null {
  if (!comment) return null;
  const m = comment.match(/\[vnetexp:([^\]]+)\]/);
  const iso = m?.[1]?.trim();
  return iso || null;
}

function extractLinkedUsername(comment: string | null | undefined): string | null {
  if (!comment) return null;
  const withoutTag = stripStructuralSuffixes(comment);
  const legacy = withoutTag.match(/^auto-bypass:user:(.+)$/i)?.[1]?.trim();
  if (legacy) return legacy;
  const m = withoutTag.match(/\(([^()]+)\)\s*$/);
  const candidate = m?.[1]?.trim();
  return candidate ? candidate : null;
}

function parseExpiryFromComment(comment: string | null | undefined): Date | null {
  if (!comment) return null;
  const m1 = comment.match(/([a-z]{3}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2}(?::\d{2})?)/i);
  if (m1) {
    const d = new Date(`${m1[1]} ${m1[2]}`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const m2 = comment.match(/(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}(?::\d{2})?)/);
  if (m2) {
    const d = new Date(`${m2[1]}T${m2[2]}`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

async function syncRouter(routerId: number, conn: RouterConnection) {
  const [users, bindings, profiles] = await Promise.all([
    listHotspotUsers(conn, 20_000),
    listIpBindings(conn),
    listProfiles(conn),
  ]);
  const usersByName = new Map(users.map((u) => [u.username.toLowerCase(), u]));
  const validityByProfile = new Map(profiles.map((p) => [p.name.toLowerCase(), p.validity]));
  const now = Date.now();

  for (const b of bindings) {
    const standaloneIso = extractVnetexpIso(b.comment);
    if (standaloneIso) {
      const endMs = Date.parse(standaloneIso);
      if (!Number.isNaN(endMs) && now >= endMs && !b.disabled) {
        await updateIpBinding(conn, b.id, { disabled: true });
        continue;
      }
    }

    const uname = extractLinkedUsername(b.comment)?.toLowerCase() ?? "";
    if (!uname) continue;
    const user = usersByName.get(uname);
    const profTag = extractVnetbpProfile(b.comment);
    const exp = parseExpiryFromComment(user?.comment);

    let shouldDisable: boolean;
    if (!user) {
      shouldDisable = true;
    } else if (exp) {
      shouldDisable = exp.getTime() <= now;
    } else if (profTag && user.profile.toLowerCase() === profTag.toLowerCase()) {
      const lim = user.limitUptime?.trim();
      const remMs = lim ? parseRouterDurationToMs(lim) : null;
      if (remMs !== null && remMs <= 0) {
        shouldDisable = true;
      } else {
        const validityStr = validityByProfile.get(user.profile.toLowerCase()) ?? null;
        const validityMs = validityStr ? parseRouterDurationToMs(validityStr) : null;
        if (validityMs !== null && remMs !== null && remMs > 0 && remMs < validityMs * 0.01) {
          shouldDisable = false;
        } else if (validityMs !== null && remMs !== null && remMs <= 0) {
          shouldDisable = true;
        } else {
          shouldDisable = false;
        }
      }
    } else {
      shouldDisable = false;
    }

    if (b.disabled !== shouldDisable) {
      await updateIpBinding(conn, b.id, { disabled: shouldDisable });
    }
  }

  void routerId;
}

export function startAutoBypassSync() {
  if (timer) return;
  const intervalMs = Number(process.env.AUTO_BYPASS_SYNC_INTERVAL_MS || DEFAULT_INTERVAL_MS);

  const run = async () => {
    try {
      const routers = await db.select().from(routersTable);
      for (const r of routers) {
        const conn: RouterConnection = { host: r.host, port: r.port, username: r.username, password: r.password };
        try {
          await syncRouter(r.id, conn);
        } catch (err) {
          logger.warn({ routerId: r.id, err }, "auto-bypass sync failed for router");
        }
      }
    } catch (err) {
      logger.warn({ err }, "auto-bypass global sync failed");
    }
  };

  void run();
  timer = setInterval(() => { void run(); }, intervalMs);
}
