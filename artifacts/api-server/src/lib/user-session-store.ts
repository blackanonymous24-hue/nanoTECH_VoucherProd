import { randomUUID } from "crypto";
import type { Request } from "express";
import { eq } from "drizzle-orm";
import { db, userSessionsTable } from "@workspace/db";

export type UserSessionType = "admin" | "vendor" | "manager" | "collaborateur";

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
