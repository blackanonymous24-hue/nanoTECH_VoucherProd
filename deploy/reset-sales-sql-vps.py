#!/usr/bin/env python3
"""Vide le cache ventes PostgreSQL puis redémarre l'API (resync au prochain dashboard)."""
from __future__ import annotations
import re, sys
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

sql = """
TRUNCATE TABLE mikrotik_script_sales_month_sync RESTART IDENTITY;
TRUNCATE TABLE mikrotik_script_sales RESTART IDENTITY;
"""
cmd = (
    "bash -lc 'cd /var/www/vouchernet && "
    "export $(grep -E ^DATABASE_URL= .env | xargs) && "
    f"psql \"$DATABASE_URL\" -c \"{sql}\" && "
    "pm2 restart vouchernet-api --update-env'"
)
print("Purge globale ventes (TRUNCATE) + restart API pour vider les caches RAM.")
_, o, e = c.exec_command(cmd, timeout=180)
sys.stdout.write(o.read().decode("utf-8", errors="replace"))
err = e.read().decode("utf-8", errors="replace")
if err.strip():
    sys.stdout.write("STDERR: " + err)
code = o.channel.recv_exit_status() if hasattr(o, "channel") else 0
c.close()
sys.exit(0 if code == 0 else code)
