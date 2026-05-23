#!/usr/bin/env python3
"""Diagnostic ventes dashboard — City Connect / DIOUF."""
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

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(env["VPS_HOST"], port=int(env.get("VPS_PORT", "22")), username=env["VPS_USER"], password=env["VPS_SSH_PASSWORD"], timeout=30)

def psql_one(sql: str) -> str:
    import base64
    b64 = base64.b64encode(sql.encode("utf-8")).decode("ascii")
    cmd = (
        "bash -lc 'cd /var/www/vouchernet && "
        "export $(grep -E ^DATABASE_URL= .env | xargs) && "
        f"psql \"$DATABASE_URL\" -c \"$(echo {b64} | base64 -d)\"'"
    )
    _, o, e = c.exec_command(cmd, timeout=120)
    out = o.read().decode("utf-8", errors="replace")
    err = e.read().decode("utf-8", errors="replace")
    if err.strip() and "ERROR" in err.upper():
        sys.stdout.write("ERR: " + err + "\n")
    return out

names = ["CITY", "DIOUF", "city", "diouf"]
for needle in ["%CITY%", "%DIOUF%"]:
    sys.stdout.write(f"\n=== Routeurs ILIKE {needle} ===\n")
    sys.stdout.write(psql_one(f"SELECT id, name, host FROM routers WHERE name ILIKE '{needle}' ORDER BY id;"))

for needle in ["%CITY%", "%DIOUF%"]:
    sys.stdout.write(f"\n=== Stats mois + aujourd'hui (sale_date) {needle} ===\n")
    sys.stdout.write(psql_one(f"""
SELECT r.name,
  (SELECT count(*)::int FROM mikrotik_script_sales s
   WHERE s.router_id = r.id AND s.sale_date >= date_trunc('month', CURRENT_DATE)) AS scripts_mois,
  (SELECT coalesce(sum(nullif(regexp_replace(s.price, '[^0-9.]', '', 'g'), '')::numeric), 0)::bigint
   FROM mikrotik_script_sales s
   WHERE s.router_id = r.id AND s.sale_date >= date_trunc('month', CURRENT_DATE)) AS sum_mois,
  (SELECT count(*)::int FROM mikrotik_script_sales s
   WHERE s.router_id = r.id AND (s.sale_date AT TIME ZONE 'UTC')::date = CURRENT_DATE) AS scripts_aujour_utc,
  (SELECT count(*)::int FROM mikrotik_script_sales s
   WHERE s.router_id = r.id AND split_part(s.raw_name, '-|-', 1) LIKE to_char(CURRENT_DATE, 'YYYY-MM-DD') || '%') AS scripts_aujour_raw_iso,
  (SELECT count(*)::int FROM mikrotik_script_sales s
   WHERE s.router_id = r.id AND split_part(s.raw_name, '-|-', 1) LIKE lower(to_char(CURRENT_DATE, 'Mon/DD/YYYY')) || '%') AS scripts_aujour_raw_legacy
FROM routers r WHERE r.name ILIKE '{needle}';
""".strip()))

def rid(needle: str) -> str:
    _, o, _ = c.exec_command(
        "bash -lc 'cd /var/www/vouchernet && export $(grep -E ^DATABASE_URL= .env | xargs) && "
        f"psql \"$DATABASE_URL\" -t -A -c \"SELECT id FROM routers WHERE name ILIKE ''{needle}'' LIMIT 1\"'",
        timeout=30,
    )
    return o.read().decode().strip()

city_id = rid("%CITY%")
diouf_id = rid("%DIOUF%")

import urllib.request
for label, rid in [("CITY", city_id), ("DIOUF", diouf_id)]:
    if not rid:
        continue
    path = f"/api/routers/{rid}/dashboard-priority"
    try:
        with urllib.request.urlopen(f"https://nanovoucher.com{path}", timeout=90) as r:
            d = json.loads(r.read().decode())
            s = d.get("sales") or {}
            info = d.get("info") or {}
            print(f"\nAPI {label} ({path}):")
            print("  clock", info.get("clockDate"), info.get("clockTime"))
            print("  daily", s.get("dailyCount"), s.get("dailyAmount"))
            print("  monthly", s.get("monthlyCount"), s.get("monthlyAmount"))
            print("  salesKnown", (d.get("availability") or {}).get("salesKnown"))
    except Exception as ex:
        print(path, ex)

c.close()
