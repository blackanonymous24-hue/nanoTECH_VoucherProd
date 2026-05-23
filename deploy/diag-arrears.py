"""Diagnose why 'versements non effectues' disappeared on vendor portal.

For each vendor with daily settlement_mode, replicate the server logic and
print sales/days vs paid for the last 35 days excluding today.
"""
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

print("== Vendor settlement columns ==")
_, o, _ = c.exec_command(
    "sudo -u postgres psql -d vouchernet -A -c \""
    "\\d vendors\""
)
print(o.read().decode()[:2500])

print("\n== Active vendors with daily/weekly settlement mode ==")
_, o, _ = c.exec_command(
    "sudo -u postgres psql -d vouchernet -A -c \""
    "SELECT id, name, router_id, settlement_mode, commission_rate, is_active "
    "FROM vendors WHERE is_active = true ORDER BY id;\""
)
print(o.read().decode())

print("\n== Sales by day per vendor (last 14d, excl today) — to see who has unpaid days ==")
_, o, _ = c.exec_command(
    "sudo -u postgres psql -d vouchernet -A -c \""
    "SELECT v.id AS vendor_id, v.name, (used_at)::date AS day, "
    "       count(*)::int AS sold, "
    "       coalesce(sum(coalesce(nullif(sale_price,'')::numeric, nullif(price,'')::numeric, 0)), 0)::int AS amount "
    "FROM vouchers v_join "
    "JOIN vendors v ON v.id = v_join.vendor_id "
    "WHERE v_join.used_at IS NOT NULL "
    "  AND (v_join.used_at)::date >= (current_date - interval '14 days')::date "
    "  AND (v_join.used_at)::date < current_date "
    "GROUP BY v.id, v.name, (used_at)::date "
    "ORDER BY v.id, day DESC LIMIT 60;\""
)
print(o.read().decode())

print("\n== Daily payments table — sample of recent rows ==")
_, o, _ = c.exec_command(
    "sudo -u postgres psql -d vouchernet -A -c \""
    "SELECT vendor_id, date, amount, created_at "
    "FROM vendor_daily_payments "
    "WHERE date >= (current_date - interval '14 days') "
    "ORDER BY date DESC, vendor_id LIMIT 30;\""
)
print(o.read().decode())
c.close()
