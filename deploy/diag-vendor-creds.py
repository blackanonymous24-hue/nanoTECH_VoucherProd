"""Login as vendor 5 (ADJARA, daily) and check /me/daily-arrears + /me/payments."""
from __future__ import annotations
import io, sys
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=True)
import paramiko, json

env = {}
for line in (Path(__file__).resolve().parent / "vps.local.env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line: continue
    k, _, v = line.partition("=")
    env[k.strip()] = v.strip()

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(env["VPS_HOST"], port=int(env.get("VPS_PORT", 22)), username=env["VPS_USER"], password=env["VPS_SSH_PASSWORD"], timeout=20)

print("== Active vendor credentials (username + plain) ==")
_, o, _ = c.exec_command(
    "sudo -u postgres psql -d vouchernet -A -c \""
    "SELECT id, name, username, password_plain, settlement_mode, commission_rate, router_id, is_active "
    "FROM vendors WHERE username IS NOT NULL AND is_active = true ORDER BY id LIMIT 20;\""
)
print(o.read().decode())
c.close()
