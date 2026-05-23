"""Verify lot-print is fast on router 47 after the targeted-query fix."""
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

# Wait for service to stabilize
print("== Service running with the patch ==")
print(run("systemctl show vouchernet --property=ActiveEnterTimestamp,SubState"))

print("\n== Patch logs after restart ==")
print(run("journalctl -u vouchernet --since '3 min ago' --no-pager 2>&1 | grep -i 'mikrotik-patch' | tail -5"))

print("\n== Test /lot-print directly via curl (router 47, lot vc-459-05.23.26) ==")
print(run(
    "time curl -sS --max-time 35 "
    "'http://127.0.0.1:3000/api/routers/47/lot-print?comment=vc-459-05.23.26' "
    "-o /tmp/lpr.json -w 'HTTP=%{http_code}  TIME=%{time_total}s  SIZE=%{size_download}\\n' "
    "2>&1 || true"
))
print(run("ls -la /tmp/lpr.json 2>&1; echo '---first 500 bytes:'; head -c 500 /tmp/lpr.json 2>&1; echo"))

print("\n== Now hit again to confirm cache hit (should be near-instant) ==")
print(run(
    "curl -sS --max-time 5 "
    "'http://127.0.0.1:3000/api/routers/47/lot-print?comment=vc-459-05.23.26' "
    "-o /tmp/lpr2.json -w 'HTTP=%{http_code}  TIME=%{time_total}s\\n'"
))

print("\n== Recent /lot-print requests in journal ==")
print(run(
    "journalctl -u vouchernet --since '2 min ago' --no-pager 2>&1 | "
    "grep -E '\"url\":\"/api/routers/[0-9]+/lot-print' | tail -10"
))

print("\n== Errors level>=40 last 2 min ==")
print(run(
    "journalctl -u vouchernet --since '2 min ago' --no-pager 2>&1 | "
    "grep -E '\"level\":(40|50)' | head -20"
))

c.close()
