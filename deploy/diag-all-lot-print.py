"""All lot-print attempts in last 60 min + any non-200 status."""
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

print("== ALL /lot-print attempts in last 90 min (all routers, all clients) ==")
print(run(
    "awk '$4 >= \"[23/May/2026:13:08:00\"' /var/log/nginx/access.log 2>/dev/null | "
    "grep '/lot-print' | tail -50"
))

print("\n== Other voucher-related endpoints recent (vouchers/print, generate) ==")
print(run(
    "awk '$4 >= \"[23/May/2026:14:00:00\"' /var/log/nginx/access.log 2>/dev/null | "
    "grep -E '/api/(vouchers|routers)/[0-9]*/?(print|generate|lots|hotspot-users)' | tail -30"
))

print("\n== Auto-bypass sync error frequency (per minute) ==")
print(run(
    "journalctl -u vouchernet --since '60 min ago' --no-pager 2>&1 | "
    "grep 'auto-bypass sync failed' | "
    "awk '{print substr($0,1,21)}' | sort | uniq -c | tail -10"
))

print("\n== Number of concurrent in-flight requests (estimate via started but not completed) ==")
print(run(
    "journalctl -u vouchernet --since '5 min ago' --no-pager 2>&1 | "
    "grep -cE 'incoming request' || echo '0 incoming'; "
    "journalctl -u vouchernet --since '5 min ago' --no-pager 2>&1 | "
    "grep -cE 'request (completed|errored)' || echo '0 completed/errored'"
))

c.close()
