"""Deep dive: lot-print on router 47 after 14:09 + the actual error bodies."""
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

print("== All /lot-print on router 47 since service start (14:09+) ==")
print(run(
    "journalctl -u vouchernet --since '2026-05-23 14:09:00' --no-pager 2>&1 | "
    "grep -E '\"url\":\"/api/routers/47/lot-print' | "
    "python3 -c \"import sys, json, re;\n"
    "for line in sys.stdin:\n"
    "  m = re.search(r'vouchernet\\[[0-9]+\\]: ({.+})', line);\n"
    "  if not m: continue\n"
    "  d = json.loads(m.group(1))\n"
    "  ts = line.split('vouchernet')[0].strip()\n"
    "  url = d.get('req',{}).get('url','')\n"
    "  sc = d.get('res',{}).get('statusCode')\n"
    "  rt = d.get('responseTime')\n"
    "  err = d.get('err',{}).get('message','')\n"
    "  print(f'{ts}  status={sc}  time={rt}ms  url={url[:80]}  err={err[:60]}')\""
))

print("\n== Latest /lot-print success on router 47 (find any 200) ==")
print(run(
    "journalctl -u vouchernet --since '2026-05-23 13:00:00' --no-pager 2>&1 | "
    "grep -E '\"url\":\"/api/routers/47/lot-print' | "
    "grep '\"statusCode\":200' | tail -5"
))

print("\n== Nginx access for router 47 lot-print since 14:00 ==")
print(run(
    "awk '$4 >= \"[23/May/2026:14:00:00\"' /var/log/nginx/access.log 2>/dev/null | "
    "grep '/api/routers/47/lot-print' | tail -30"
))

print("\n== Curl the lot-print directly from VPS with cookie auth ==")
# Try to make a real call (will fail with 401 but we can see if logic is reachable)
print(run(
    "curl -sS --max-time 35 -w 'HTTP=%{http_code}\\nTIME=%{time_total}\\nSIZE=%{size_download}\\n' "
    "-o /tmp/lpr_47.json "
    "http://127.0.0.1:3001/api/routers/47/lot-print?comment=vc-459-05.23.26 2>&1"
))
print(run("cat /tmp/lpr_47.json"))

c.close()
