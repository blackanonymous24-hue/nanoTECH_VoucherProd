#!/usr/bin/env python3
"""Appelle dashboard-priority pour forcer la resync ventes."""
from __future__ import annotations
import json, re, sys, urllib.request
from pathlib import Path
import paramiko

env: dict[str, str] = {}
for line in Path(__file__).resolve().parent.joinpath("vps.local.env").read_text(encoding="utf-8").splitlines():
    m = re.match(r"([A-Za-z_][A-Za-z0-9_]*)=(.*)", line.strip())
    if m:
        env[m.group(1)] = m.group(2).strip().strip('"').strip("'")

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(env["VPS_HOST"], port=int(env.get("VPS_PORT", "22")), username=env["VPS_USER"], password=env["VPS_SSH_PASSWORD"], timeout=30)

def rid(needle: str) -> str:
    _, o, _ = c.exec_command(
        "bash -lc 'cd /var/www/vouchernet && export $(grep -E ^DATABASE_URL= .env | xargs) && "
        f"psql \"$DATABASE_URL\" -t -A -c \"SELECT id FROM routers WHERE name ILIKE ''{needle}'' LIMIT 1\"'",
        timeout=30,
    )
    return o.read().decode().strip()

for label, needle in [("CITY", "%CITY%"), ("DIOUF", "%DIOUF%")]:
    rid_val = rid(needle)
    if not rid_val:
        continue
    path = f"/api/routers/{rid_val}/dashboard-priority"
    print(f"Warming {label} router {rid_val}...")
    try:
        with urllib.request.urlopen(f"https://nanovoucher.com{path}", timeout=120) as r:
            d = json.loads(r.read().decode())
            s = d.get("sales") or {}
            print(f"  daily={s.get('dailyCount')} {s.get('dailyAmount')} monthly={s.get('monthlyCount')} {s.get('monthlyAmount')}")
            print(f"  clock={(d.get('info') or {}).get('clockDate')}")
    except Exception as ex:
        print("  error:", ex)

c.close()
