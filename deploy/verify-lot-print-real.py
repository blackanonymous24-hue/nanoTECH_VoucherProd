"""Test lot-print via the real Nginx URL on router 47 (Bravo connexion)."""
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

print("== Find the actual API port ==")
print(run("ss -tlnp 2>/dev/null | grep -E 'node|vouchernet|LISTEN' | head -20"))

print("\n== Real URL via nginx (no auth needed for this endpoint? let's see) ==")
# First try directly localhost on known ports
for port in (3000, 3001, 4000, 5000, 8080):
    print(f"\n--- port {port} ---")
    print(run(
        f"timeout 3 curl -sS -o /tmp/lpr_p{port}.json -w 'HTTP=%{{http_code}}\\n' "
        f"http://127.0.0.1:{port}/api/routers/47/lot-print?comment=vc-459-05.23.26 2>&1 || true"
    ))

print("\n== Process binding ==")
print(run("pgrep -af 'node|vouchernet' | head -10"))

print("\n== /lot-print successful responses since restart (ANY router) ==")
print(run(
    "journalctl -u vouchernet --since '2026-05-23 13:24:57' --no-pager 2>&1 | "
    "grep -E '\"url\":\"/api/routers/[0-9]+/lot-print' | "
    "grep -E '\"statusCode\":200' | tail -10"
))

print("\n== /lot-print failed responses since restart ==")
print(run(
    "journalctl -u vouchernet --since '2026-05-23 13:24:57' --no-pager 2>&1 | "
    "grep -E '\"url\":\"/api/routers/[0-9]+/lot-print' | "
    "grep -vE '\"statusCode\":200' | tail -10"
))

c.close()
