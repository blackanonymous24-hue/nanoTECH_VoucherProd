"""Wait 45s post-deploy, then audit /lot-print activity (APK + browser)."""
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

print("Waiting 45s for user to retry from APK...")
time.sleep(45)

print("\n== Patch lines + service start ==")
print(run("journalctl -u vouchernet --since '2 min ago' --no-pager 2>&1 | grep mikrotik-patch | head -5"))

print("\n== Application logs: /lot-print since 13:35:24 ==")
print(run(
    "journalctl -u vouchernet --since '2026-05-23 13:35:24' --no-pager 2>&1 | "
    "grep -E '\"url\":\"/api/routers/[0-9]+/lot-print' | tail -30"
))

print("\n== Nginx access for /lot-print since 13:35:24 ==")
print(run(
    "awk '$4 >= \"[23/May/2026:13:35:24\"' /var/log/nginx/access.log 2>/dev/null | "
    "grep 'lot-print' | tail -30"
))

print("\n== Any 502 errors since deploy ==")
print(run(
    "journalctl -u vouchernet --since '2026-05-23 13:35:24' --no-pager 2>&1 | "
    "grep -E '\"statusCode\":502' | head -10"
))

c.close()
