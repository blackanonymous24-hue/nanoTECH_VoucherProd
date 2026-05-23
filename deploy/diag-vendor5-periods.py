"""Verify SQL period counts for vendor 5 router 1."""
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

sql = """
SELECT vendor_id,
  count(*) filter (where used_at >= date_trunc('day', now()) and used_at < date_trunc('day', now()) + interval '1 day') AS today,
  count(*) filter (where used_at >= date_trunc('day', now()) - interval '1 day' and used_at < date_trunc('day', now())) AS yesterday,
  count(*) filter (where used_at >= date_trunc('week', current_date) and used_at < current_date + interval '1 day') AS this_week,
  count(*) filter (where used_at >= date_trunc('week', current_date - interval '1 week') and used_at < date_trunc('week', current_date)) AS last_week,
  count(*) filter (where used_at >= date_trunc('month', current_date) and used_at < date_trunc('month', current_date + interval '1 month')) AS this_month,
  count(*) filter (where used_at >= date_trunc('month', current_date - interval '1 month') and used_at < date_trunc('month', current_date)) AS last_month
FROM vouchers
WHERE vendor_id = 5
GROUP BY vendor_id;
"""
_, o, e = c.exec_command(f'sudo -u postgres psql -d vouchernet -A -c "{sql.strip().replace(chr(10), " ")}"')
print(o.read().decode() + e.read().decode())
c.close()
