"""When was the API restarted + are these timeouts new since the patch?"""
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

print("== Service start time + uptime ==")
print(run("systemctl show vouchernet --property=ActiveEnterTimestamp,MainPID,SubState"))

print("== Patch log confirmation (look for [mikrotik-patch] lines) ==")
print(run("journalctl -u vouchernet --since '2 hours ago' --no-pager 2>&1 | grep -i mikrotik-patch | head -10"))

print("== Frequency of 'RouterOS operation timed out' last 4h ==")
print(run(
    "journalctl -u vouchernet --since '4 hours ago' --no-pager 2>&1 | "
    "grep -E 'RouterOS operation timed out' | "
    "awk '{print substr($0,1,16)}' | sort | uniq -c | tail -20"
))

print("== Same look BEFORE current restart (look 30 min before ActiveEnter) ==")
print(run(
    "journalctl -u vouchernet --since '2026-05-23 12:00:00' --until '2026-05-23 12:59:00' --no-pager 2>&1 | "
    "grep -c 'RouterOS operation timed out'"
))

print("== Same AFTER restart ==")
print(run(
    "journalctl -u vouchernet --since '2026-05-23 12:59:52' --no-pager 2>&1 | "
    "grep -c 'RouterOS operation timed out'"
))

print("== Number of /vouchers/generate requests AFTER restart ==")
print(run(
    "journalctl -u vouchernet --since '2026-05-23 12:59:52' --no-pager 2>&1 | "
    "grep -E '\"url\":\"/api/vouchers/generate\"' | grep -E '\"statusCode\":(200|201)' | wc -l"
))

print("== /lot-print success/fail rate AFTER restart ==")
print(run(
    "journalctl -u vouchernet --since '2026-05-23 12:59:52' --no-pager 2>&1 | "
    "grep -E '\"url\":\"/api/routers/[0-9]+/lot-print' | "
    "python3 -c \""
    "import sys, json, re; "
    "ok=fail=0; "
    "for line in sys.stdin:\n  "
    "  m = re.search(r'vouchernet\\[[0-9]+\\]: ({.+})', line);\n  "
    "  if not m: continue\n  "
    "  d = json.loads(m.group(1));\n  "
    "  sc = d.get('res',{}).get('statusCode');\n  "
    "  if sc == 200: ok += 1\n  "
    "  else: fail += 1\n"
    "print(f'OK={ok}  FAIL={fail}')\""
))

c.close()
