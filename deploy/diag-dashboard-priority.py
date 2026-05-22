#!/usr/bin/env python3
"""Diagnostic dashboard-priority en production (ventes / sessions / cache)."""
from __future__ import annotations

import json
import re
import sys
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

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(
    env["VPS_HOST"],
    port=int(env.get("VPS_PORT", "22")),
    username=env["VPS_USER"],
    password=env["VPS_SSH_PASSWORD"],
    timeout=30,
)


def run(cmd: str, timeout: int = 120) -> str:
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    if err.strip():
        sys.stdout.write(f"STDERR: {err}\n")
    return out


# Liste routeurs + comptage scripts du mois
sql_routers = (
    "SELECT r.id, r.name, "
    "(SELECT count(*)::int FROM mikrotik_script_sales s "
    " WHERE s.router_id = r.id AND s.sale_date >= date_trunc('month', CURRENT_DATE)) "
    "FROM routers r ORDER BY r.id LIMIT 12;"
)
out = run(
    "bash -lc 'cd /var/www/vouchernet && "
    "export $(grep -E ^DATABASE_URL= .env | xargs) && "
    f"psql \"$DATABASE_URL\" -c \"{sql_routers}\"'"
)
sys.stdout.write("=== Routeurs (scripts mois courant) ===\n")
sys.stdout.write(out)

# Premier routeur avec scripts > 0
rid_out = run(
    "bash -lc 'cd /var/www/vouchernet && "
    "export $(grep -E ^DATABASE_URL= .env | xargs) && "
    "psql \"$DATABASE_URL\" -t -A -c "
    "\"SELECT id FROM routers ORDER BY id LIMIT 1\"'"
).strip()
if not rid_out:
    sys.stdout.write("Aucun routeur\n")
    client.close()
    sys.exit(0)

rid = rid_out.splitlines()[0].strip()
sys.stdout.write(f"\n=== Test buildDashboardPriority via journal PM2 (router {rid}) ===\n")

# Appel interne curl localhost (auth bypass?) — tester via node one-liner
node_cmd = f"""node -e "
const http = require('http');
const id = {rid};
const opts = {{ hostname: '127.0.0.1', port: 3001, path: '/api/routers/' + id + '/dashboard-priority', headers: {{ 'Cookie': '' }} }};
http.get(opts, (res) => {{
  let b = '';
  res.on('data', (c) => b += c);
  res.on('end', () => {{
    try {{
      const j = JSON.parse(b);
      console.log(JSON.stringify({{
        status: res.statusCode,
        sessionsCount: j.sessionsCount,
        availability: j.availability,
        sales: j.sales ? {{ dailyCount: j.sales.dailyCount, dailyAmount: j.sales.dailyAmount, monthlyCount: j.sales.monthlyCount, _cachedAt: j.sales._cachedAt }} : null,
        users: j.users,
      }}, null, 2));
    }} catch (e) {{ console.log('RAW', res.statusCode, b.slice(0, 500)); }}
  }});
}}).on('error', (e) => console.error(e.message));
"
"""
api_out = run(f"bash -lc 'cd /var/www/vouchernet && {node_cmd}'", timeout=90)
sys.stdout.write(api_out)

client.close()
