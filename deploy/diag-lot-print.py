"""Trace which router(s) timed out on /lot-print."""
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

print("== Tous les lot-print depuis le boot patché (status + temps) ==")
print(run(
    "journalctl -u vouchernet --since '2026-05-23 12:59:52' --no-pager 2>&1 | "
    "grep -E '\"url\":\"/api/routers/[0-9]+/lot-print' | tail -30"
))

print("== HotspotUser count par routeur de Mik@ (taille du print) ==")
print(run(
    "sudo -u postgres psql -d vouchernet -A -c \""
    "SELECT r.id, r.name, COUNT(v.id) AS db_vouchers "
    "FROM routers r LEFT JOIN vouchers v ON v.router_id = r.id "
    "WHERE r.owner_admin_id = 6 GROUP BY r.id, r.name ORDER BY r.id;\""
))

print("== Last 5xx errors (status 502) ==")
print(run(
    "journalctl -u vouchernet --since '2026-05-23 12:59:52' --no-pager 2>&1 | "
    "grep -E '\"statusCode\":502' | tail -10"
))

c.close()
