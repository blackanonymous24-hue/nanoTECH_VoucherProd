import type { Request } from "express";

function normalizeIp(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("::ffff:")) return trimmed.slice(7);
  if (trimmed.includes(".") && trimmed.includes(":")) {
    // IPv4-mapped IPv6 with dot notation, e.g. ::ffff:192.168.1.1
    const last = trimmed.split(":").pop();
    if (last && /^\d+\.\d+\.\d+\.\d+$/.test(last)) return last;
  }
  return trimmed;
}

function isPrivateOrLocalIp(ip: string): boolean {
  if (ip === "127.0.0.1" || ip === "::1" || ip === "localhost") return true;
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;
  const m = /^172\.(\d+)\./.exec(ip);
  if (m) {
    const second = Number(m[1]);
    if (second >= 16 && second <= 31) return true;
  }
  if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80:")) return true;
  return false;
}

/** IP client derrière nginx (nécessite `trust proxy` sur Express). */
export function getClientIp(req: Request): string | null {
  const fromExpress = req.ip?.trim();
  if (fromExpress) {
    const ip = normalizeIp(fromExpress);
    return isPrivateOrLocalIp(ip) ? null : ip;
  }
  const remote = req.socket.remoteAddress?.trim();
  if (!remote) return null;
  const ip = normalizeIp(remote);
  return isPrivateOrLocalIp(ip) ? null : ip;
}

export { isPrivateOrLocalIp };
