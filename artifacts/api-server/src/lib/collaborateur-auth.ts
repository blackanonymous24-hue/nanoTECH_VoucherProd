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

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [salt, storedKey] = hash.split(":");
    if (!salt || !storedKey) { resolve(false); return; }
    crypto.pbkdf2(password, salt, 100_000, 64, "sha512", (err, key) => {
      if (err) reject(err);
      else resolve(key.toString("hex") === storedKey);
    });
  });
}

export function createToken(collaborateurId: number, routerIds: number[]): string {
  const payload = Buffer.from(
    JSON.stringify({ collaborateurId, routerIds, exp: Date.now() + 30 * 24 * 60 * 60 * 1000 })
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyToken(token: string): { collaborateurId: number; routerIds: number[] } | null {
  try {
    const dot = token.lastIndexOf(".");
    if (dot === -1) return null;
    const payload = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expectedSig = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
    if (sig !== expectedSig) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      collaborateurId: number;
      routerIds: number[];
      exp: number;
    };
    if (data.exp < Date.now()) return null;
    return { collaborateurId: data.collaborateurId, routerIds: data.routerIds };
  } catch {
    return null;
  }
}
