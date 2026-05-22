#!/usr/bin/env python3
"""Purge globale ventes + resync via API admin (token signé avec SESSION_SECRET du VPS)."""
from __future__ import annotations

import base64
import json
import re
import sys
from pathlib import Path

import paramiko

DEPLOY = Path(__file__).resolve().parent
ENV_FILE = DEPLOY / "vps.local.env"


def load_env() -> dict[str, str]:
    out: dict[str, str] = {}
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"([A-Za-z_][A-Za-z0-9_]*)=(.*)", line)
        if m:
            out[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return out


NODE = r"""
const http = require("http");
const fs = require("fs");
const crypto = require("crypto");
const { execSync } = require("child_process");
const envPath = "/var/www/vouchernet/.env";
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}
const SECRET = process.env.SESSION_SECRET;
const dbUrl = process.env.DATABASE_URL;
if (!SECRET || !dbUrl) { console.error("SESSION_SECRET or DATABASE_URL missing"); process.exit(1); }
let adminId = 1;
let sid = 0;
try {
  const row = execSync(
    `psql "${dbUrl}" -t -A -c "SELECT id, session_epoch FROM admin_settings ORDER BY id LIMIT 1"`,
    { encoding: "utf8" },
  ).trim();
  const [idStr, epochStr] = row.split("|");
  if (idStr) adminId = parseInt(idStr, 10);
  if (epochStr) sid = parseInt(epochStr, 10);
} catch (e) {
  console.error("admin_settings lookup failed", e.message);
}
const payload = { adminId, isSuperAdmin: true, admin: true, exp: Date.now() + 3600000, sid };
const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
const sig = crypto.createHmac("sha256", SECRET).update(encoded).digest("base64url");
const token = `${encoded}.${sig}`;
const body = JSON.stringify({ resync: true, concurrency: 4 });
const opts = {
  hostname: "127.0.0.1",
  port: 3001,
  path: "/api/admin/reset-all-sales-cache",
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  },
};
const req = http.request(opts, (res) => {
  let b = "";
  res.on("data", (c) => (b += c));
  res.on("end", () => {
    console.log("HTTP", res.statusCode);
    try {
      const j = JSON.parse(b);
      console.log(JSON.stringify({ purged: j.purged, routers: j.routers, resync: j.resync }, null, 2));
      const errs = (j.results || []).filter((r) => r.error);
      if (errs.length) {
        console.log("errors", errs.length);
        console.log(JSON.stringify(errs.slice(0, 8), null, 2));
      }
    } catch {
      console.log(b.slice(0, 4000));
    }
  });
});
req.on("error", (e) => { console.error(e.message); process.exit(1); });
req.write(body);
req.end();
"""


def main() -> None:
    if not ENV_FILE.is_file():
        sys.stderr.write(f"Missing {ENV_FILE}\n")
        sys.exit(1)
    env = load_env()
    password = env.get("VPS_SSH_PASSWORD", "")
    if not password or password == "CHANGE_ME":
        sys.stderr.write("Set VPS_SSH_PASSWORD in deploy/vps.local.env\n")
        sys.exit(1)

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(
        env.get("VPS_HOST", "69.62.110.53"),
        port=int(env.get("VPS_PORT", "22")),
        username=env.get("VPS_USER", "root"),
        password=password,
        timeout=30,
    )
    b64 = base64.b64encode(NODE.encode()).decode()
    cmd = f"bash -lc 'cd /var/www/vouchernet && echo {b64} | base64 -d | node'"
    print("==> POST /api/admin/reset-all-sales-cache (purge + resync)...")
    _, o, e = c.exec_command(cmd, timeout=900)
    sys.stdout.write(o.read().decode("utf-8", errors="replace"))
    err = e.read().decode("utf-8", errors="replace")
    if err.strip():
        sys.stdout.write("STDERR: " + err)
    code = o.channel.recv_exit_status()
    c.close()
    sys.exit(0 if code == 0 else code)


if __name__ == "__main__":
    main()
