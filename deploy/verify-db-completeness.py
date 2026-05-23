"""Verify DB has all needed columns for lot vc-459-05.23.26 on router 47."""
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

print("== Sample vouchers from router 47 lots (data completeness) ==")
print(run(
    "sudo -u postgres psql -d vouchernet -A -c \""
    "SELECT username, "
    "CASE WHEN password IS NULL OR password = '' THEN '(empty)' ELSE 'OK' END AS pw, "
    "profile_name, price, validity, comment "
    "FROM vouchers WHERE router_id = 47 AND comment LIKE 'vc-%' LIMIT 5;\""
))

print("\n== Aggregate completeness per lot on router 47 ==")
print(run(
    "sudo -u postgres psql -d vouchernet -A -c \""
    "SELECT comment, COUNT(*) AS total, "
    "COUNT(*) FILTER (WHERE password IS NOT NULL AND password <> '') AS with_pw, "
    "COUNT(*) FILTER (WHERE profile_name IS NOT NULL AND profile_name <> '') AS with_prof "
    "FROM vouchers WHERE router_id = 47 AND comment IS NOT NULL "
    "GROUP BY comment ORDER BY COUNT(*) DESC LIMIT 10;\""
))

print("\n== Specifically vc-459-05.23.26 ==")
print(run(
    "sudo -u postgres psql -d vouchernet -A -c \""
    "SELECT username, LEFT(password, 3) || '***' AS pw, profile_name, price, validity "
    "FROM vouchers WHERE router_id = 47 AND comment = 'vc-459-05.23.26' LIMIT 5;\""
))

c.close()
