import { randomUUID } from "crypto";
import type { Request } from "express";
import { eq, gte, inArray, sql } from "drizzle-orm";
import {
  db,
  userSessionsTable,
  adminSettingsTable,
  vendorsTable,
  managersTable,
  collaborateursTable,
} from "@workspace/db";

export type UserSessionType = "admin" | "vendor" | "manager" | "collaborateur";

const STAFF_USER_TYPES: UserSessionType[] = ["admin", "manager", "collaborateur"];

/** Fenêtre « en ligne » pour le monitoring super-admin. */
export const MONITORING_ONLINE_MINUTES = 5;

/** Ne pas écrire last_active_at plus souvent (par session). */
const LAST_ACTIVE_TOUCH_INTERVAL_MS = 120_000;
const lastActiveTouchAt = new Map<string, number>();

export function newSessionId(): string {
  return randomUUID();
}

export function deviceLabelFromRequest(req: Request): string | null {
  const ua = req.headers["user-agent"];
  if (!ua || typeof ua !== "string") return null;
  const trimmed = ua.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 240) : null;
}

export function isSessionPersistentRequest(req: Request): boolean {
  const h = req.headers["x-session-persistent"];
  if (typeof h === "string") return h === "1" || h.toLowerCase() === "true";
  return false;
}

export async function registerUserSession(params: {
  sessionId: string;
  userType: UserSessionType;
  userId: number;
  deviceLabel?: string | null;
  persistent?: boolean;
}): Promise<void> {
  await db.insert(userSessionsTable).values({
    sessionId: params.sessionId,
    userType: params.userType,
    userId: params.userId,
    deviceLabel: params.deviceLabel ?? null,
    persistent: params.persistent === true,
  } as typeof userSessionsTable.$inferInsert);
}

export async function isUserSessionActive(sessionId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: userSessionsTable.id })
    .from(userSessionsTable)
    .where(eq(userSessionsTable.sessionId, sessionId))
    .limit(1);
  return !!row;
}

export async function revokeUserSessionById(sessionId: string): Promise<boolean> {
  const deleted = await db
    .delete(userSessionsTable)
    .where(eq(userSessionsTable.sessionId, sessionId))
    .returning({ id: userSessionsTable.id });
  return deleted.length > 0;
}

/** Sessions admin / gérant / collaborateur — pilotent les sync MikroTik staff. */
export async function hasActiveStaffSessions(): Promise<boolean> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userSessionsTable)
    .where(inArray(userSessionsTable.userType, STAFF_USER_TYPES));
  return (row?.count ?? 0) > 0;
}

/** Sessions vendeur — pilotent la sync portail vendeur. */
export async function hasActiveVendorSessions(): Promise<boolean> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userSessionsTable)
    .where(eq(userSessionsTable.userType, "vendor"));
  return (row?.count ?? 0) > 0;
}

/** Aucun utilisateur connecté — pas de sync MikroTik en arrière-plan. */
export async function hasAnyUserSessions(): Promise<boolean> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userSessionsTable);
  return (row?.count ?? 0) > 0;
}

export async function touchUserSessionLastActive(sessionId: string): Promise<void> {
  const now = Date.now();
  const prev = lastActiveTouchAt.get(sessionId) ?? 0;
  if (now - prev < LAST_ACTIVE_TOUCH_INTERVAL_MS) return;
  lastActiveTouchAt.set(sessionId, now);
  await db
    .update(userSessionsTable)
    .set({ lastActiveAt: new Date() })
    .where(eq(userSessionsTable.sessionId, sessionId));
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function startOfWeekMonday(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const start = startOfDay(d);
  start.setDate(start.getDate() - diff);
  return start;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1);
}

async function countSessionsSince(since: Date): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userSessionsTable)
    .where(gte(userSessionsTable.createdAt, since));
  return row?.count ?? 0;
}

export type MonitoringConnectionStats = {
  day: number;
  week: number;
  month: number;
  year: number;
};

export async function getMonitoringConnectionStats(now = new Date()): Promise<MonitoringConnectionStats> {
  const [day, week, month, year] = await Promise.all([
    countSessionsSince(startOfDay(now)),
    countSessionsSince(startOfWeekMonday(now)),
    countSessionsSince(startOfMonth(now)),
    countSessionsSince(startOfYear(now)),
  ]);
  return { day, week, month, year };
}

export type MonitoringLiveSession = {
  sessionId: string;
  userType: UserSessionType;
  userId: number;
  displayName: string;
  login: string | null;
  tenantLabel: string | null;
  deviceLabel: string | null;
  deviceShort: string;
  createdAt: string;
  lastActiveAt: string;
  isOnline: boolean;
  persistent: boolean;
};

function shortenDeviceLabel(ua: string | null): string {
  if (!ua) return "Appareil inconnu";
  const s = ua.trim();
  if (/iPhone|iPad|iPod/i.test(s)) {
    return /CriOS|Chrome/i.test(s) ? "Chrome (iOS)" : "Safari (iOS)";
  }
  if (/Android/i.test(s)) {
    return /Chrome/i.test(s) ? "Chrome (Android)" : "Android";
  }
  if (/Windows/i.test(s)) {
    if (/Edg\//i.test(s)) return "Edge (Windows)";
    if (/Chrome/i.test(s)) return "Chrome (Windows)";
    if (/Firefox/i.test(s)) return "Firefox (Windows)";
    return "Windows";
  }
  if (/Mac OS X/i.test(s)) {
    if (/Chrome/i.test(s)) return "Chrome (macOS)";
    if (/Safari/i.test(s) && !/Chrome/i.test(s)) return "Safari (macOS)";
    return "macOS";
  }
  if (/Linux/i.test(s)) return /Chrome/i.test(s) ? "Chrome (Linux)" : "Linux";
  return s.length > 48 ? `${s.slice(0, 45)}…` : s;
}

type UserIdentity = { displayName: string; login: string | null; tenantLabel: string | null };

async function resolveUserIdentity(userType: UserSessionType, userId: number): Promise<UserIdentity> {
  if (userType === "admin") {
    const [row] = await db
      .select({
        login: adminSettingsTable.login,
        displayName: adminSettingsTable.displayName,
      })
      .from(adminSettingsTable)
      .where(eq(adminSettingsTable.id, userId))
      .limit(1);
    const login = row?.login ?? `#${userId}`;
    return {
      displayName: row?.displayName?.trim() || login,
      login,
      tenantLabel: login,
    };
  }
  if (userType === "vendor") {
    const [row] = await db
      .select({
        name: vendorsTable.name,
        username: vendorsTable.username,
        ownerAdminId: vendorsTable.ownerAdminId,
      })
      .from(vendorsTable)
      .where(eq(vendorsTable.id, userId))
      .limit(1);
    const tenantLabel = row?.ownerAdminId
      ? await tenantLoginForAdminId(row.ownerAdminId)
      : null;
    return {
      displayName: row?.name?.trim() || row?.username || `Vendeur #${userId}`,
      login: row?.username ?? null,
      tenantLabel,
    };
  }
  if (userType === "manager") {
    const [row] = await db
      .select({
        name: managersTable.name,
        username: managersTable.username,
        ownerAdminId: managersTable.ownerAdminId,
      })
      .from(managersTable)
      .where(eq(managersTable.id, userId))
      .limit(1);
    const tenantLabel = row?.ownerAdminId
      ? await tenantLoginForAdminId(row.ownerAdminId)
      : null;
    return {
      displayName: row?.name?.trim() || row?.username || `Gérant #${userId}`,
      login: row?.username ?? null,
      tenantLabel,
    };
  }
  const [row] = await db
    .select({
      name: collaborateursTable.name,
      username: collaborateursTable.username,
      ownerAdminId: collaborateursTable.ownerAdminId,
    })
    .from(collaborateursTable)
    .where(eq(collaborateursTable.id, userId))
    .limit(1);
  const tenantLabel = row?.ownerAdminId
    ? await tenantLoginForAdminId(row.ownerAdminId)
    : null;
  return {
    displayName: row?.name?.trim() || row?.username || `Collaborateur #${userId}`,
    login: row?.username ?? null,
    tenantLabel,
  };
}

async function tenantLoginForAdminId(adminId: number): Promise<string | null> {
  const [row] = await db
    .select({ login: adminSettingsTable.login })
    .from(adminSettingsTable)
    .where(eq(adminSettingsTable.id, adminId))
    .limit(1);
  return row?.login ?? null;
}

export async function getMonitoringLiveSessions(now = new Date()): Promise<MonitoringLiveSession[]> {
  const onlineSince = new Date(now.getTime() - MONITORING_ONLINE_MINUTES * 60_000);
  const rows = await db
    .select()
    .from(userSessionsTable)
    .orderBy(sql`${userSessionsTable.lastActiveAt} DESC`);

  const sessions: MonitoringLiveSession[] = [];
  for (const row of rows) {
    const userType = row.userType as UserSessionType;
    if (!["admin", "vendor", "manager", "collaborateur"].includes(userType)) continue;
    const identity = await resolveUserIdentity(userType, row.userId);
    const lastActiveAt = row.lastActiveAt ?? row.createdAt;
    sessions.push({
      sessionId: row.sessionId,
      userType,
      userId: row.userId,
      displayName: identity.displayName,
      login: identity.login,
      tenantLabel: identity.tenantLabel,
      deviceLabel: row.deviceLabel,
      deviceShort: shortenDeviceLabel(row.deviceLabel),
      createdAt: row.createdAt.toISOString(),
      lastActiveAt: lastActiveAt.toISOString(),
      isOnline: lastActiveAt >= onlineSince,
      persistent: row.persistent,
    });
  }
  return sessions;
}
