/**
 * Quand l'adresse ou les identifiants API changent, le cache ventes peut pointer vers
 * un autre MikroTik. On purge sauf si le numéro de série routeurboard est identique.
 */
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db, routersTable } from "@workspace/db";
import { getRouterInfo, type RouterConnection } from "./mikrotik.js";
import { logger } from "./logger.js";
import {
  DEFAULT_ROUTER_API_PORT,
  mergeMikhmonHostPort,
  normalizeRouterHostPort,
} from "./router-host.js";
import { resetRouterSalesCache } from "./script-cache.js";

export type RouterConnSnapshot = {
  host: string;
  port: number;
  username: string;
  password: string;
  mikrotikSerial: string | null;
};

export type RouterConnPatch = {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
};

let serialColumnEnsured = false;

/** Colonne optionnelle — migration idempotente au premier usage. */
export async function ensureRouterMikrotikSerialColumn(): Promise<void> {
  if (serialColumnEnsured) return;
  try {
    await db.execute(sql`
      ALTER TABLE routers ADD COLUMN IF NOT EXISTS mikrotik_serial text
    `);
    serialColumnEnsured = true;
  } catch (err) {
    logger.warn({ err }, "routers: impossible d'ajouter mikrotik_serial");
  }
}

function normEndpoint(host: string, port: number): { host: string; port: number } {
  return normalizeRouterHostPort(host.trim(), port > 0 ? port : DEFAULT_ROUTER_API_PORT);
}

/** true si host/port/username/password effectifs changent. */
export function routerConnectionPatchChanged(
  before: RouterConnSnapshot,
  patch: RouterConnPatch,
): boolean {
  const merged = mergedConnectionFromPatch(before, patch);
  const b = normEndpoint(before.host, before.port);
  const a = normEndpoint(merged.host, merged.port);
  if (b.host !== a.host || b.port !== a.port) return true;
  if (merged.username !== before.username) return true;
  if (patch.password !== undefined && patch.password !== "") return true;
  return false;
}

export function mergedConnectionFromPatch(
  before: RouterConnSnapshot,
  patch: RouterConnPatch,
): RouterConnection {
  let host = before.host;
  let port = before.port;
  if (patch.host !== undefined) {
    const merged = mergeMikhmonHostPort(patch.host, patch.port ?? before.port);
    host = merged.host;
    port = merged.port;
  } else if (patch.port !== undefined) {
    port = patch.port > 0 ? patch.port : DEFAULT_ROUTER_API_PORT;
  }
  const { host: h, port: p } = normEndpoint(host, port);
  return {
    host: h,
    port: p,
    username: patch.username !== undefined ? patch.username : before.username,
    password:
      patch.password !== undefined && patch.password !== ""
        ? patch.password
        : before.password,
  };
}

export type ReconnectSalesResetResult = {
  salesCacheCleared: boolean;
  mikrotikSerial: string | null;
  reason: string;
};

/**
 * Après changement IP/API : lit le n° de série MikroTik et purge le cache ventes
 * si l'équipement semble différent (ou si la série n'est pas vérifiable).
 */
export async function reconcileSalesCacheAfterConnectionChange(
  routerId: number,
  before: RouterConnSnapshot,
  patch: RouterConnPatch,
): Promise<ReconnectSalesResetResult> {
  await ensureRouterMikrotikSerialColumn();

  if (!routerConnectionPatchChanged(before, patch)) {
    return {
      salesCacheCleared: false,
      mikrotikSerial: before.mikrotikSerial,
      reason: "unchanged",
    };
  }

  const conn = mergedConnectionFromPatch(before, patch);
  let newSerial: string | null = null;
  try {
    const info = await getRouterInfo(conn);
    newSerial = info.serialNumber?.trim() || null;
  } catch (err) {
    logger.warn({ routerId, err }, "reconnect: lecture n° série impossible");
  }

  const prevSerial = before.mikrotikSerial?.trim() || null;
  let shouldClear = true;
  let reason = "connection_changed";

  if (newSerial && prevSerial && newSerial === prevSerial) {
    shouldClear = false;
    reason = "same_serial";
  } else if (!newSerial || !prevSerial) {
    shouldClear = true;
    reason = newSerial ? "serial_new_device" : "serial_unavailable";
  } else {
    shouldClear = true;
    reason = "serial_mismatch";
  }

  if (shouldClear) {
    const cleared = await resetRouterSalesCache(routerId);
    logger.info(
      { routerId, reason, deletedSales: cleared.deletedSales, newSerial, prevSerial },
      "reconnect: cache ventes purgé (autre MikroTik ou IP non vérifiable)",
    );
    return { salesCacheCleared: true, mikrotikSerial: newSerial, reason };
  }

  logger.info({ routerId, newSerial }, "reconnect: même MikroTik (n° série), ventes conservées");
  return { salesCacheCleared: false, mikrotikSerial: newSerial ?? prevSerial, reason };
}

/** Enregistre le n° de série au premier contact réussi (dashboard / ping). */
export async function persistRouterMikrotikSerialIfMissing(
  routerId: number,
  serial: string | null | undefined,
): Promise<void> {
  const s = serial?.trim();
  if (!s) return;
  await ensureRouterMikrotikSerialColumn();
  await db
    .update(routersTable)
    .set({ mikrotikSerial: s })
    .where(
      and(
        eq(routersTable.id, routerId),
        or(isNull(routersTable.mikrotikSerial), eq(routersTable.mikrotikSerial, "")),
      ),
    );
}
