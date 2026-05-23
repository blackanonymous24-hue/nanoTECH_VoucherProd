"""Check /lot-print calls since the fix (success/fail + user-agent if logged)."""
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

print("== All /lot-print since the fix deploy ==")
print(run(
    "journalctl -u vouchernet --since '2026-05-23 13:24:57' --no-pager 2>&1 | "
    "grep -E '\"url\":\"/api/routers/[0-9]+/lot-print' | tail -20"
))

print("\n== Errors level>=40 since the fix deploy ==")
print(run(
    "journalctl -u vouchernet --since '2026-05-23 13:24:57' --no-pager 2>&1 | "
    "grep -E '\"level\":50|\"statusCode\":50[0-9]' | head -10"
))

print("\n== Nginx access for /lot-print (with user-agent) ==")
print(run(
    "ls /var/log/nginx/ 2>&1 | head -10; "
    "echo '---'; "
    "find /var/log/nginx -name '*access*' -newer /tmp -mmin -60 2>/dev/null | head -3; "
    "echo '---'; "
    "grep -E 'lot-print' /var/log/nginx/access.log 2>/dev/null | tail -20"
))

print("\n== Cache-Control headers for /api/* ==")
print(run("grep -rE 'add_header|Cache-Control' /etc/nginx/sites-enabled/ 2>&1 | head -20"))

print("\n== /api/* nginx config ==")
print(run("grep -rE 'location.*api|proxy_pass' /etc/nginx/sites-enabled/ 2>&1 | head -20"))

c.close()
