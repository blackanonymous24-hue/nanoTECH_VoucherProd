/**
 * Quand l'adresse (host/port) du routeur change, le cache ventes peut pointer vers
 * un autre MikroTik. On purge systématiquement, sans vérification du numéro de série.
 */
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db, routersTable } from "@workspace/db";
import { type RouterConnection } from "./mikrotik.js";
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

/** true si host ou port effectifs changent. Username/password ignorés (n'invalident pas les ventes). */
export function routerConnectionPatchChanged(
  before: RouterConnSnapshot,
  patch: RouterConnPatch,
): boolean {
  const merged = mergedConnectionFromPatch(before, patch);
  const b = normEndpoint(before.host, before.port);
  const a = normEndpoint(merged.host, merged.port);
  return b.host !== a.host || b.port !== a.port;
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
 * Après changement d'IP/host : purge inconditionnellement le cache ventes local.
 * Plus de vérification de numéro de série — on suppose qu'un autre endpoint =
 * potentiellement un autre MikroTik, donc on remet à zéro pour éviter les
 * ventes fantômes liées à un ancien équipement.
 */
export async function reconcileSalesCacheAfterConnectionChange(
  routerId: number,
  before: RouterConnSnapshot,
  patch: RouterConnPatch,
): Promise<ReconnectSalesResetResult> {
  if (!routerConnectionPatchChanged(before, patch)) {
    return {
      salesCacheCleared: false,
      mikrotikSerial: before.mikrotikSerial,
      reason: "unchanged",
    };
  }

  const cleared = await resetRouterSalesCache(routerId);
  logger.info(
    { routerId, deletedSales: cleared.deletedSales, reason: "host_or_port_changed" },
    "reconnect: cache ventes purgé (IP/host modifié)",
  );
  return {
    salesCacheCleared: true,
    mikrotikSerial: null,
    reason: "host_or_port_changed",
  };
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
