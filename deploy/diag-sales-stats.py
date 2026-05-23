"""Diagnose the sales-stats period bug: timezone mismatch vs data presence."""
from __future__ import annotations
import io, sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=True)
import paramiko

HERE = Path(__file__).resolve().parent
env = {}
for line in (HERE / "vps.local.env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, _, v = line.partition("=")
    env[k.strip()] = v.strip()

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(env["VPS_HOST"], port=int(env.get("VPS_PORT", 22)),
          username=env["VPS_USER"], password=env["VPS_SSH_PASSWORD"], timeout=20)

def run(cmd: str) -> str:
    _, stdout, stderr = c.exec_command(cmd)
    return stdout.read().decode("utf-8", errors="replace") + stderr.read().decode("utf-8", errors="replace")

print("== Postgres timezone + current date/time ==")
print(run(
    "sudo -u postgres psql -d vouchernet -A -c \""
    "SHOW timezone; "
    "SELECT now() AS now_utc, current_date AS curdate, "
    "date_trunc('week', current_date) AS week_start, "
    "date_trunc('month', current_date) AS month_start;\""
))

print("\n== Sample used vouchers — recent 10 with used_at ==")
print(run(
    "sudo -u postgres psql -d vouchernet -A -c \""
    "SELECT id, router_id, vendor_id, profile_name, used_at "
    "FROM vouchers WHERE used_at IS NOT NULL "
    "ORDER BY used_at DESC LIMIT 10;\""
))

print("\n== Tickets sold THIS WEEK per vendor (any router) ==")
print(run(
    "sudo -u postgres psql -d vouchernet -A -c \""
    "SELECT vendor_id, COUNT(*) AS week_sold "
    "FROM vouchers "
    "WHERE used_at >= date_trunc('week', current_date) "
    "  AND used_at < current_date + interval '1 day' "
    "GROUP BY vendor_id ORDER BY week_sold DESC LIMIT 15;\""
))

print("\n== Tickets sold THIS MONTH per vendor (matches dashboard 1055) ==")
print(run(
    "sudo -u postgres psql -d vouchernet -A -c \""
    "SELECT vendor_id, COUNT(*) AS month_sold "
    "FROM vouchers "
    "WHERE used_at >= date_trunc('month', '2026-05-23'::date AT TIME ZONE 'UTC')::timestamptz "
    "  AND used_at < date_trunc('month', '2026-06-01'::date AT TIME ZONE 'UTC')::timestamptz "
    "GROUP BY vendor_id ORDER BY month_sold DESC LIMIT 15;\""
))

print("\n== Same month BUT using `current_date` (Postgres-side) ==")
print(run(
    "sudo -u postgres psql -d vouchernet -A -c \""
    "SELECT vendor_id, COUNT(*) AS month_sold "
    "FROM vouchers "
    "WHERE used_at >= date_trunc('month', current_date) "
    "  AND used_at < date_trunc('month', current_date + interval '1 month') "
    "GROUP BY vendor_id ORDER BY month_sold DESC LIMIT 15;\""
))

c.close()
