#!/usr/bin/env python3
"""Diagnostique POST reset-all-sales-cache sur le VPS."""
from __future__ import annotations

import base64
import re
import sys
from pathlib import Path

import paramiko

ENV_FILE = Path(__file__).resolve().parent / "vps.local.env"


def load_env() -> dict[str, str]:
    out: dict[str, str] = {}
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        m = re.match(r"([A-Za-z_][A-Za-z0-9_]*)=(.*)", line.strip())
        if m:
            out[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return out


NODE = r"""
const http = require("http");
const fs = require("fs");
const crypto = require("crypto");
const { execSync } = require("child_process");
for (const line of fs.readFileSync("/var/www/vouchernet/.env", "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}
const SECRET = process.env.SESSION_SECRET;
const dbUrl = process.env.DATABASE_URL;
const row = execSync(
  `psql "${dbUrl}" -t -A -c "SELECT id, session_epoch FROM admin_settings ORDER BY id LIMIT 1"`,
  { encoding: "utf8" },
).trim();
const [idStr, epochStr] = row.split("|");
const adminId = parseInt(idStr, 10);
const sid = parseInt(epochStr, 10);
const payload = { adminId, isSuperAdmin: true, admin: true, exp: Date.now() + 3600000, sid };
const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
const sig = crypto.createHmac("sha256", SECRET).update(encoded).digest("base64url");
const token = `${encoded}.${sig}`;
const body = JSON.stringify({ resync: false });
const req = http.request({
  hostname: "127.0.0.1", port: 3001,
  path: "/api/admin/reset-all-sales-cache",
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
}, (res) => {
  let b = "";
  res.on("data", (c) => (b += c));
  res.on("end", () => console.log("status", res.statusCode, "body", b));
});
req.on("error", (e) => console.error("req err", e.message));
req.write(body);
req.end();
"""


def main() -> None:
    env = load_env()
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(env["VPS_HOST"], port=int(env.get("VPS_PORT", "22")), username=env["VPS_USER"], password=env["VPS_SSH_PASSWORD"], timeout=30)
    b64 = base64.b64encode(NODE.encode()).decode()
    _, o, e = c.exec_command(f"bash -lc 'echo {b64} | base64 -d | node'", timeout=60)
    sys.stdout.write(o.read().decode("utf-8", errors="replace"))
    sys.stdout.write(e.read().decode("utf-8", errors="replace"))
    c.close()


if __name__ == "__main__":
    main()
