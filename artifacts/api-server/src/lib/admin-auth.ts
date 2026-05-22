import crypto from "crypto";

const SECRET = process.env.SESSION_SECRET ?? "fallback-dev-secret-change-me";

export async function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");
    crypto.pbkdf2(password, salt, 100_000, 64, "sha512", (err, key) => {
      if (err) reject(err);
      else resolve(`${salt}:${key.toString("hex")}`);
    });
  });
}

/** Comparaison sensible à la casse (octets exacts du mot de passe saisi). */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [salt, storedKey] = hash.split(":");
    if (!salt || !storedKey) { resolve(false); return; }
    crypto.pbkdf2(password, salt, 100_000, 64, "sha512", (err, key) => {
      if (err) reject(err);
      else {
        try {
          const derived = Buffer.from(key.toString("hex"), "hex");
          const expected = Buffer.from(storedKey, "hex");
          resolve(
            derived.length === expected.length &&
            crypto.timingSafeEqual(derived, expected),
          );
        } catch {
          resolve(false);
        }
      }
    });
  });
}

interface AdminTokenPayload {
  // Identifies the admin row in admin_settings.
  adminId: number;
  // True iff this admin can manage other admins (super-admin tier).
  isSuperAdmin: boolean;
  // Legacy flag still embedded for backward compatibility with the old
  // boolean check; always `true` for any admin token we issue.
  admin: true;
  exp: number;
  sid: number;
  /** UUID session appareil (user_sessions). */
  ssid?: string;
}

export function createAdminToken(
  adminId: number,
  isSuperAdmin: boolean,
  sessionEpoch: number,
  sessionId?: string,
): string {
  const payload: AdminTokenPayload = {
    adminId,
    isSuperAdmin,
    admin: true,
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
    sid: sessionEpoch,
    ...(sessionId ? { ssid: sessionId } : {}),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

/**
 * Decode and verify an admin token. Returns the embedded claims when valid,
 * or null when the signature, expiry, or shape is wrong.
 *
 * Use this when a route needs to know WHO the admin is (e.g. for tenant
 * scoping or super-admin gating). For a simple yes/no check, see
 * `verifyAdminToken` which preserves the original boolean API.
 */
export function verifyAdminTokenFull(token: string): {
  adminId: number;
  isSuperAdmin: boolean;
  sessionEpoch: number;
  sessionId?: string;
} | null {
  try {
    const dot = token.lastIndexOf(".");
    if (dot === -1) return null;
    const payload = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expectedSig = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
    if (sig !== expectedSig) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<AdminTokenPayload>;
    if (!data.admin || typeof data.exp !== "number" || data.exp < Date.now()) return null;
    // adminId is required for new tokens; older tokens (issued before this
    // release) won't carry it and are treated as invalid so users re-login.
    if (typeof data.adminId !== "number") return null;
    const sessionEpoch = typeof data.sid === "number" && Number.isFinite(data.sid) ? data.sid : 0;
    const sessionId = typeof data.ssid === "string" && data.ssid.length > 0 ? data.ssid : undefined;
    return { adminId: data.adminId, isSuperAdmin: !!data.isSuperAdmin, sessionEpoch, sessionId };
  } catch {
    return null;
  }
}

/**
 * Boolean-only admin token check. Kept for backward compatibility with the
 * many existing routes that just need to confirm "this is an admin token".
 * New code should prefer `verifyAdminTokenFull` to also access claims.
 */
export function verifyAdminToken(token: string): boolean {
  return verifyAdminTokenFull(token) !== null;
}
