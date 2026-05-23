"""Wait 60s more for user test, then capture lot-print outcomes."""
from __future__ import annotations
import io, sys, time
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

print("Waiting 90s for user/APK to retry...")
time.sleep(90)

print("\n== /lot-print outcomes since deploy ==")
print(run(
    "awk '$4 >= \"[23/May/2026:13:35:25\"' /var/log/nginx/access.log 2>/dev/null | "
    "grep 'lot-print' | tail -40"
))

print("\n== App log /lot-print since deploy (responseTime focus) ==")
print(run(
    "journalctl -u vouchernet --since '2026-05-23 13:35:24' --no-pager 2>&1 | "
    "grep -oE '\"url\":\"/api/routers/[0-9]+/lot-print[^\"]*\".*\"statusCode\":[0-9]+,\"responseTime\":[0-9]+' | tail -30"
))

c.close()
