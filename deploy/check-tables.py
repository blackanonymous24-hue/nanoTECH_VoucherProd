"""Find users table + check API route via curl with sudo."""
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
    ("sudo -u postgres psql -d vouchernet -A -c \"\\dt\"", "list tables"),
    ("curl -sS -w 'HTTP %{http_code}\\n' http://127.0.0.1:3001/api/vendors/reports/summary?routerId=1 -o /tmp/probe.json && head -c 300 /tmp/probe.json", "unauth probe"),
]:
    print(f"\n== {desc} ==")
    _, o, e = c.exec_command(cmd)
    print(o.read().decode("utf-8", errors="replace") + e.read().decode("utf-8", errors="replace"))
c.close()
