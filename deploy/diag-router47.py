"""Identify router 47 + capture the actual MikroTik error message."""
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

print("== Routeur 47 ==")
print(run(
    "sudo -u postgres psql -d vouchernet -A -c \""
    "SELECT r.id, r.name, r.host, r.port, r.owner_admin_id, a.username AS admin "
    "FROM routers r LEFT JOIN admins a ON a.id = r.owner_admin_id WHERE r.id = 47;\""
))

print("== Lots du routeur 47 (taille des prints) ==")
print(run(
    "sudo -u postgres psql -d vouchernet -A -c \""
    "SELECT comment, COUNT(*) FROM vouchers WHERE router_id = 47 "
    "GROUP BY comment ORDER BY COUNT(*) DESC LIMIT 10;\""
))

print("== Volume total hotspot/user prévu sur routeur 47 ==")
print(run(
    "sudo -u postgres psql -d vouchernet -A -c \""
    "SELECT COUNT(*) AS total_db_users FROM vouchers WHERE router_id = 47;\""
))

print("== Erreurs MikroTik récentes (routeur 47) ==")
print(run(
    "journalctl -u vouchernet --since '2026-05-23 12:59:52' --no-pager 2>&1 | "
    "grep -E 'router.*47|routerId.*47|/routers/47/' | grep -E 'level\":[45]' | tail -10"
))

print("== Search 'RouterOS operation timed out' ==")
print(run(
    "journalctl -u vouchernet --since '2026-05-23 12:59:52' --no-pager 2>&1 | "
    "grep -E 'RouterOS operation timed out|operation timed out' | tail -15"
))

print("== Tous les statusCode=502 (URL + msg) ==")
print(run(
    "journalctl -u vouchernet --since '2026-05-23 12:59:52' --no-pager 2>&1 | "
    "grep -E '\"statusCode\":502' | python3 -c \""
    "import sys, json; "
    "[print(d.get('req',{}).get('url'), '|', d.get('responseTime'), 'ms', '|', d.get('err',{}).get('message')) "
    "for line in sys.stdin for d in [json.loads(line.split('vouchernet[')[1].split(']: ',1)[1]) if 'vouchernet[' in line else json.loads(line)]]\" | tail -20"
))

print("== Latest hotspot/user MikroTik errors (any) ==")
print(run(
    "journalctl -u vouchernet --since '2026-05-23 12:59:52' --no-pager 2>&1 | "
    "grep -iE 'hotspot.user|timed out|trap|fatal|EHOST|ECONN' | grep -vE 'routes/vouchers' | tail -25"
))

c.close()
