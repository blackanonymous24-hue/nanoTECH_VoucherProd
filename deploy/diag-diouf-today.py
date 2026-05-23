#!/usr/bin/env python3
"""Diagnostic ventes du jour — DIOUF CONNEXION."""
from __future__ import annotations
import json, re, shlex, sys
from pathlib import Path
import paramiko

env = {}
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

def psql(sql: str) -> str:
    q = shlex.quote(sql)
    cmd = f"bash -lc 'cd /var/www/vouchernet && export $(grep -E ^DATABASE_URL= .env | xargs) && psql \"$DATABASE_URL\" -c {q}'"
    _, o, e = c.exec_command(cmd, timeout=120)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    if err.strip():
        sys.stdout.write("SQL ERR: " + err + "\n")
    return out

queries = [
    ("Routeur DIOUF", "SELECT id, name, host FROM routers WHERE name ILIKE '%DIOUF%';"),
    ("Comptages par jour (sale_date UTC)", """
SELECT (sale_date AT TIME ZONE 'UTC')::date AS d, count(*)::int AS n
FROM mikrotik_script_sales
WHERE router_id = (SELECT id FROM routers WHERE name ILIKE '%DIOUF%' LIMIT 1)
  AND sale_date >= date_trunc('month', CURRENT_DATE)
GROUP BY 1 ORDER BY 1 DESC LIMIT 10;
"""),
    ("Aujourd'hui par sale_date UTC", """
SELECT count(*)::int FROM mikrotik_script_sales
WHERE router_id = (SELECT id FROM routers WHERE name ILIKE '%DIOUF%' LIMIT 1)
  AND (sale_date AT TIME ZONE 'UTC')::date = CURRENT_DATE;
"""),
    ("Aujourd'hui par raw_name (date script)", """
SELECT count(*)::int FROM mikrotik_script_sales
WHERE router_id = (SELECT id FROM routers WHERE name ILIKE '%DIOUF%' LIMIT 1)
  AND sale_date >= date_trunc('month', CURRENT_DATE)
  AND (
    raw_name LIKE '2026-05-22%'
    OR raw_name LIKE 'may/22/2026%'
  );
"""),
    ("Sync mois", """
SELECT year, month, script_count, mikrotik_sync_at, verified_at
FROM mikrotik_script_sales_month_sync
WHERE router_id = (SELECT id FROM routers WHERE name ILIKE '%DIOUF%' LIMIT 1)
ORDER BY year DESC, month DESC LIMIT 3;
"""),
]

for title, sql in queries:
    sys.stdout.write(f"\n=== {title} ===\n")
    sys.stdout.write(psql(sql.strip()))

_, o2, _ = c.exec_command(
    "bash -lc 'cd /var/www/vouchernet && export $(grep -E ^DATABASE_URL= .env | xargs) && "
    "psql \"$DATABASE_URL\" -t -A -c \"select id from routers where name ilike '%DIOUF%' limit 1\"'",
    timeout=30,
)
rid = o2.read().decode().strip()
c.close()

if rid:
    import urllib.request
    path = f"/api/routers/{rid}/dashboard-priority"
    try:
        with urllib.request.urlopen(f"https://nanovoucher.com{path}", timeout=60) as r:
            d = json.loads(r.read().decode())
            s = d.get("sales") or {}
            print(f"\nAPI {path}:")
            print("  daily", s.get("dailyCount"), s.get("dailyAmount"))
            print("  monthly", s.get("monthlyCount"), s.get("monthlyAmount"))
            print("  clock", (d.get("info") or {}).get("clockDate"))
    except Exception as ex:
        print(path, ex)
