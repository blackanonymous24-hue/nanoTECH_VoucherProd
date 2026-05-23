"""Check PM2 logs and ping a public endpoint."""
from __future__ import annotations
import io, sys
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=True)
import paramiko

env = {}
for line in (Path(__file__).resolve().parent / "vps.local.env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line: continue
    k, _, v = line.partition("=")
    env[k.strip()] = v.strip()

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(env["VPS_HOST"], port=int(env.get("VPS_PORT", 22)), username=env["VPS_USER"], password=env["VPS_SSH_PASSWORD"], timeout=20)

for cmd, desc in [
    ("pm2 status --no-color | head -30", "pm2 status"),
    ("pm2 logs --nostream --lines 40 --raw 2>&1 | tail -60", "pm2 logs (last 60 lines)"),
    ("curl -sS -o /dev/null -w 'HTTP %{http_code} %{time_total}s\\n' http://127.0.0.1:3000/api/health 2>&1 || true", "ping /api/health"),
]:
    print(f"\n== {desc} ==")
    _, o, e = c.exec_command(cmd)
    print(o.read().decode("utf-8", errors="replace") + e.read().decode("utf-8", errors="replace"))
c.close()
