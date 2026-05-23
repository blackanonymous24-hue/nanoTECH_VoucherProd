#!/usr/bin/env python3
from __future__ import annotations
import base64, re, sys
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

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(env["VPS_HOST"], port=int(env.get("VPS_PORT", "22")), username=env["VPS_USER"], password=env["VPS_SSH_PASSWORD"], timeout=30)

def q(sql: str) -> str:
    b64 = base64.b64encode(sql.encode("utf-8")).decode("ascii")
    cmd = (
        "bash -lc 'cd /var/www/vouchernet && "
        "export $(grep -E ^DATABASE_URL= .env | xargs) && "
        f"psql \"$DATABASE_URL\" -c \"$(echo {b64} | base64 -d)\"'"
    )
    _, o, _ = c.exec_command(cmd, timeout=60)
    return o.read().decode("utf-8", errors="replace")

print("=== DIOUF CONNEXION — 5 dernières ventes en base ===")
print(q("SELECT to_char(sale_date AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS sd, split_part(raw_name,'-|-',1) AS script_day, username, price FROM mikrotik_script_sales WHERE router_id=11 ORDER BY sale_date DESC LIMIT 8;"))

print("=== CITY CONNECT — ventes par jour script (top 10) ===")
print(q("SELECT split_part(raw_name,'-|-',1) AS d, count(*)::int AS n FROM mikrotik_script_sales WHERE router_id=44 AND sale_date >= date_trunc('month', CURRENT_DATE) GROUP BY 1 ORDER BY n DESC LIMIT 10;"))

c.close()
