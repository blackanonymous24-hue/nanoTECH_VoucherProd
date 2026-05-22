#!/usr/bin/env python3
"""Purge globale ventes + resync mois (tous routeurs) via POST /api/admin/reset-all-sales-cache."""
from __future__ import annotations
import json, re, sys
from pathlib import Path
import paramiko

env: dict[str, str] = {}
for line in Path(__file__).resolve().parent.joinpath("vps.local.env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    m = re.match(r"([A-Za-z_][A-Za-z0-9_]*)=(.*)", line)
    if m:
        env[m.group(1)] = m.group(2).strip().strip('"').strip("'")

token = env.get("ADMIN_API_TOKEN", "").strip()
if not token:
    sys.stderr.write("ADMIN_API_TOKEN manquant dans deploy/vps.local.env\n")
    sys.exit(1)

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(env["VPS_HOST"], port=int(env.get("VPS_PORT", "22")), username=env["VPS_USER"], password=env["VPS_SSH_PASSWORD"], timeout=30)

node = f"""
const http = require('http');
const opts = {{
  hostname: '127.0.0.1',
  port: 3001,
  path: '/api/admin/reset-all-sales-cache',
  method: 'POST',
  headers: {{ Authorization: 'Bearer {token}', 'Content-Type': 'application/json' }},
}};
const body = JSON.stringify({{ resync: true, concurrency: 4 }});
const req = http.request(opts, (res) => {{
  let b = '';
  res.on('data', (c) => b += c);
  res.on('end', () => {{
    console.log('HTTP', res.statusCode);
    try {{ console.log(JSON.stringify(JSON.parse(b), null, 2)); }}
    catch {{ console.log(b.slice(0, 2000)); }}
  }});
}});
req.on('error', (e) => console.error(e.message));
req.write(body);
req.end();
"""

_, o, e = c.exec_command(f"bash -lc 'cd /var/www/vouchernet && node -e {json.dumps(node)}'", timeout=600)
sys.stdout.write(o.read().decode("utf-8", errors="replace"))
err = e.read().decode("utf-8", errors="replace")
if err.strip():
    sys.stdout.write("STDERR: " + err)
c.close()
