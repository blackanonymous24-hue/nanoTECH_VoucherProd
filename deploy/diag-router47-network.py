"""Get router 47 + check VPN reachability + ALL routers ping summary."""
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

print("== Schema (find admin table name) ==")
print(run("sudo -u postgres psql -d vouchernet -A -c \"\\dt\" | head -40"))

print("== Routeur 47 ==")
print(run("sudo -u postgres psql -d vouchernet -A -c \"SELECT id,name,host,port,owner_admin_id FROM routers WHERE id=47;\""))

print("== Ping router 47 over VPN (3 packets, 1s timeout) ==")
print(run(
    "ROW=$(sudo -u postgres psql -d vouchernet -At -c \"SELECT host FROM routers WHERE id=47;\") && "
    "echo \"host=$ROW\" && "
    "ping -c 3 -W 1 -i 0.3 \"$ROW\" 2>&1 || true"
))

print("== TCP connect test to router 47:port ==")
print(run(
    "HP=$(sudo -u postgres psql -d vouchernet -At -c \"SELECT host || ' ' || port FROM routers WHERE id=47;\") && "
    "echo \"hostport=$HP\" && "
    "set -- $HP && "
    "timeout 5 bash -c \"</dev/tcp/$1/$2\" 2>&1 && echo OK || echo \"TCP failed\""
))

print("== Routers connectivity overview (recent timeout count per router) ==")
print(run(
    "journalctl -u vouchernet --since '2026-05-23 12:59:52' --no-pager 2>&1 | "
    "grep 'RouterOS operation timed out' | "
    "grep -oE 'routerId\":[0-9]+' | sort | uniq -c | sort -rn | head -20"
))

c.close()
