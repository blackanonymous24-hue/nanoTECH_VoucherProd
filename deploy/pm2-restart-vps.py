#!/usr/bin/env python3
import re, sys
from pathlib import Path
import paramiko

env: dict[str, str] = {}
for line in Path(__file__).resolve().parent.joinpath("vps.local.env").read_text(encoding="utf-8").splitlines():
    m = re.match(r"([A-Za-z_][A-Za-z0-9_]*)=(.*)", line.strip())
    if m:
        env[m.group(1)] = m.group(2).strip().strip('"').strip("'")

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(env["VPS_HOST"], port=int(env.get("VPS_PORT", "22")), username=env["VPS_USER"], password=env["VPS_SSH_PASSWORD"], timeout=30)
_, o, e = c.exec_command("bash -lc 'pm2 list; cd /var/www/vouchernet; pm2 restart all'", timeout=60)
sys.stdout.write(o.read().decode())
sys.stdout.write(e.read().decode())
c.close()
