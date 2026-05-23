"""Check vendor_payments and replay daily-arrears logic for vendor 5 (ADJARA, daily)."""
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

print("== vendor_payments table — last 35 days ==")
_, o, _ = c.exec_command(
    "sudo -u postgres psql -d vouchernet -A -c \""
    "SELECT vendor_id, week_start, amount, created_at "
    "FROM vendor_payments "
    "WHERE week_start >= (current_date - interval '35 days') "
    "ORDER BY week_start DESC, vendor_id LIMIT 30;\""
)
print(o.read().decode())

print("\n== vendor_daily_payments — ALL recent rows (any date) ==")
_, o, _ = c.exec_command(
    "sudo -u postgres psql -d vouchernet -A -c \""
    "SELECT vendor_id, date, amount, created_at "
    "FROM vendor_daily_payments "
    "ORDER BY date DESC, vendor_id LIMIT 30;\""
)
print(o.read().decode())

print("\n== vendor_daily_payments COUNT total ==")
_, o, _ = c.exec_command(
    "sudo -u postgres psql -d vouchernet -A -c \"SELECT count(*) FROM vendor_daily_payments;\""
)
print(o.read().decode())

print("\n== Sales for vendor 5 (ADJARA daily) last 35d EXCLUDING today ==")
_, o, _ = c.exec_command(
    "sudo -u postgres psql -d vouchernet -A -c \""
    "SELECT (used_at)::date AS day, count(*)::int AS sold, "
    "       coalesce(sum(coalesce(nullif(sale_price,'')::numeric, nullif(price,'')::numeric, 0)), 0)::int AS amount "
    "FROM vouchers WHERE vendor_id = 5 AND used_at IS NOT NULL "
    "  AND (used_at)::date >= (current_date - interval '35 days')::date "
    "  AND (used_at)::date < current_date "
    "GROUP BY (used_at)::date ORDER BY day DESC LIMIT 35;\""
)
print(o.read().decode()[:2500])
c.close()
