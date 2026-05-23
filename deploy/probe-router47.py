"""Probe router 47 directly + look for serial lock issues."""
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

print("== Router 47 details (host:port) ==")
print(run("sudo -u postgres psql -d vouchernet -A -c \"SELECT id,name,host,port,username FROM routers WHERE id=47;\""))

print("\n== TCP connect to API port (3s timeout) ==")
print(run(
    "HP=$(sudo -u postgres psql -d vouchernet -At -c \"SELECT host || ' ' || port FROM routers WHERE id=47;\") && "
    "set -- $HP && echo \"host=$1 port=$2\" && "
    "for i in 1 2 3 4 5; do timeout 3 bash -c \"</dev/tcp/$1/$2\" 2>&1 && echo \"try$i OK\" || echo \"try$i FAIL\"; done"
))

print("\n== Try a /api node-routeros connect via curl-like probe (need creds) ==")
print(run(
    "sudo -u postgres psql -d vouchernet -A -c \"SELECT id,name,host,port,username,'PASSWORD-REDACTED' FROM routers WHERE id=47;\""
))

print("\n== Time taken by router 47 RouterOS connect from VPS (TCP only) ==")
print(run(
    "HP=$(sudo -u postgres psql -d vouchernet -At -c \"SELECT host || ' ' || port FROM routers WHERE id=47;\") && "
    "set -- $HP && time timeout 10 bash -c \"</dev/tcp/$1/$2\" 2>&1"
))

print("\n== Compare with router 11 (Mik@ DIOUF CONNEXION, works) ==")
print(run(
    "HP=$(sudo -u postgres psql -d vouchernet -At -c \"SELECT host || ' ' || port FROM routers WHERE id=11;\") && "
    "set -- $HP && echo \"router 11: host=$1 port=$2\" && "
    "time timeout 10 bash -c \"</dev/tcp/$1/$2\" 2>&1"
))

print("\n== List of routers that timeout most ==")
print(run(
    "journalctl -u vouchernet --since '2026-05-23 14:00:00' --no-pager 2>&1 | "
    "grep 'RouterOS operation timed out' | "
    "grep -oE 'routerId\":[0-9]+' | sort | uniq -c | sort -rn | head -10"
))

print("\n== Same routers BUT successful since 14:00 (lot-print OR /users etc.) ==")
print(run(
    "journalctl -u vouchernet --since '2026-05-23 14:00:00' --no-pager 2>&1 | "
    "grep -E '\"statusCode\":200' | "
    "grep -oE '/api/routers/[0-9]+/' | sort | uniq -c | sort -rn | head -10"
))

print("\n== Last 5 successful operations on router 47 since boot ==")
print(run(
    "journalctl -u vouchernet --since '2026-05-23 13:00:00' --no-pager 2>&1 | "
    "grep -E '\"url\":\"/api/routers/47/' | "
    "grep -E '\"statusCode\":200' | tail -5"
))

c.close()
