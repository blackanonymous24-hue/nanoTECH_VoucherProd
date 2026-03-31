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

export function createToken(vendorId: number): string {
  const payload = Buffer.from(
    JSON.stringify({ vendorId, exp: Date.now() + 30 * 24 * 60 * 60 * 1000 })
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyToken(token: string): { vendorId: number } | null {
  try {
    const dot = token.lastIndexOf(".");
    if (dot === -1) return null;
    const payload = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expectedSig = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
    if (sig !== expectedSig) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      vendorId: number;
      exp: number;
    };
    if (data.exp < Date.now()) return null;
    return { vendorId: data.vendorId };
  } catch {
    return null;
  }
}
