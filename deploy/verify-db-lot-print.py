"""Wait 30s, then test lot-print on router 47 via curl-equivalent + watch logs."""
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

print("== Service status (should be running) ==")
print(run("systemctl show vouchernet --property=MainPID,ActiveEnterTimestamp,SubState"))

# Try lot-print directly — will hit 401 (no session) but proves the handler doesn't time out
print("\n== Direct call to localhost:3001 (no auth) — proves handler is fast ==")
print(run(
    "time curl -sS --max-time 5 -o /tmp/out.json -w 'HTTP=%{http_code}\\nTIME=%{time_total}s\\nSIZE=%{size_download}\\n' "
    "'http://127.0.0.1:3001/api/routers/47/lot-print?comment=vc-459-05.23.26' 2>&1"
))
print(run("cat /tmp/out.json"))

# Wait for actual user retry
print("\nWaiting 45s for user to retry from APK...")
time.sleep(45)

print("\n== /lot-print results since deploy ==")
print(run(
    "awk '$4 >= \"[23/May/2026:14:48:20\"' /var/log/nginx/access.log 2>/dev/null | "
    "grep '/lot-print' | tail -30"
))

print("\n== App log /lot-print since deploy ==")
print(run(
    "journalctl -u vouchernet --since '2026-05-23 14:48:20' --no-pager 2>&1 | "
    "grep -E '\"url\":\"/api/routers/[0-9]+/lot-print' | tail -30"
))

c.close()
