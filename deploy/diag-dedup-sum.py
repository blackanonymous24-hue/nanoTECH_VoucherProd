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

for rid, name in [(44, "CITY CONNECT"), (11, "DIOUF CONNEXION")]:
    print(f"\n=== {name} (id={rid}) ===")
    print(q(f"""
SELECT count(*)::int AS lignes,
  count(DISTINCT lower(username)||'|'||split_part(raw_name,'-|-',1)||'|'||coalesce(price,''))::int AS uniques_jour_script,
  coalesce(sum(sub.q),0)::bigint AS sum_uniques
FROM (
  SELECT DISTINCT ON (lower(username), split_part(raw_name,'-|-',1), coalesce(price,''))
    nullif(regexp_replace(price, '[^0-9.]', '', 'g'), '')::numeric AS q
  FROM mikrotik_script_sales
  WHERE router_id={rid} AND sale_date >= date_trunc('month', CURRENT_DATE)
) sub;
""".strip()))

c.close()
