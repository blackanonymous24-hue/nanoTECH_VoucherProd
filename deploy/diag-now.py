"""Diagnose what's failing NOW on /lot-print + check the last good revision."""
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

print("== Service current PID + start time ==")
print(run("systemctl show vouchernet --property=MainPID,ActiveEnterTimestamp,SubState"))

print("\n== Nginx ALL lot-print requests in last 30 min (URL + status + time + user-agent) ==")
print(run(
    "awk '$4 >= \"[23/May/2026:14:00:00\"' /var/log/nginx/access.log 2>/dev/null | "
    "grep 'lot-print' | tail -40"
))

print("\n== App log: all /lot-print since 13:35:24 (responseTime focus) ==")
print(run(
    "journalctl -u vouchernet --since '2026-05-23 13:35:24' --no-pager 2>&1 | "
    "grep -E '\"url\":\"/api/routers/[0-9]+/lot-print' | tail -30"
))

print("\n== Last 502 errors with body details ==")
print(run(
    "journalctl -u vouchernet --since '2026-05-23 13:35:24' --no-pager 2>&1 | "
    "grep -E '\"statusCode\":502' | tail -10"
))

print("\n== Recent withRouter / RouterOS errors ==")
print(run(
    "journalctl -u vouchernet --since '2026-05-23 14:00:00' --no-pager 2>&1 | "
    "grep -iE 'timed out|UNKNOWNREPLY|UNREGISTEREDTAG|connection refused|ECONNRESET' | tail -15"
))

c.close()
