"""Inspect vendor_daily_payments structure and ALL rows."""
from __future__ import annotations
import io, sys
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=True)
import paramiko

env = {}
for line in (Path(__file__).resolve().parent / "vps.local.env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line: continue
    k, _, v = line.partition("=")
    env[k.strip()] = v.strip()

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(env["VPS_HOST"], port=int(env.get("VPS_PORT", 22)), username=env["VPS_USER"], password=env["VPS_SSH_PASSWORD"], timeout=20)

for cmd, desc in [
    ("sudo -u postgres psql -d vouchernet -A -c \"\\d vendor_daily_payments\"", "schema"),
    ("sudo -u postgres psql -d vouchernet -A -c \"SELECT min(date), max(date), count(*) FROM vendor_daily_payments;\"", "date range"),
    ("sudo -u postgres psql -d vouchernet -A -c \"SELECT count(*) filter (where date IS NULL) AS null_dates, count(*) filter (where date >= '2026-04-01') AS recent FROM vendor_daily_payments;\"", "null+recent"),
    ("sudo -u postgres psql -d vouchernet -A -c \"SELECT * FROM vendor_daily_payments ORDER BY id DESC LIMIT 20;\"", "raw last 20"),
    ("sudo -u postgres psql -d vouchernet -A -c \"\\d vendor_payments\"", "vendor_payments schema"),
    ("sudo -u postgres psql -d vouchernet -A -c \"SELECT min(week_start), max(week_start), count(*) FROM vendor_payments;\"", "vendor_payments range"),
    ("sudo -u postgres psql -d vouchernet -A -c \"SELECT * FROM vendor_payments ORDER BY id DESC LIMIT 15;\"", "vendor_payments raw last 15"),
]:
    print(f"\n== {desc} ==")
    _, o, e = c.exec_command(cmd)
    print(o.read().decode("utf-8", errors="replace")[:3000] + e.read().decode("utf-8", errors="replace"))
c.close()
