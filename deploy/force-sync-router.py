#!/usr/bin/env python3
"""Force sync script cache pour un routeur (via node sur le VPS)."""
from __future__ import annotations
import base64, re, sys
from pathlib import Path
import paramiko

router_id = int(sys.argv[1]) if len(sys.argv) > 1 else 11

env: dict[str, str] = {}
for line in Path(__file__).resolve().parent.joinpath("vps.local.env").read_text(encoding="utf-8").splitlines():
    m = re.match(r"([A-Za-z_][A-Za-z0-9_]*)=(.*)", line.strip())
    if m:
        env[m.group(1)] = m.group(2).strip().strip('"').strip("'")

script = f"""
import {{ syncScriptCache }} from './artifacts/api-server/dist/lib/script-cache.js';
import {{ db, routersTable }} from './lib/db/src/index.js';
import {{ eq }} from 'drizzle-orm';
const id = {router_id};
const [r] = await db.select().from(routersTable).where(eq(routersTable.id, id));
if (!r) {{ console.log('not found'); process.exit(1); }}
const conn = {{ host: r.host, port: r.port, username: r.username, password: r.password }};
const n = await syncScriptCache(id, conn, null, {{ forceFullMonth: true, skipBackfill: true }});
console.log('inserted', n);
process.exit(0);
"""

# Fallback: curl admin force-sync if built JS import fails — use psql count after HTTP
node_simple = f"""
const http = require('http');
const id = {router_id};
http.get({{ hostname: '127.0.0.1', port: 3001, path: '/api/routers/' + id + '/dashboard-priority' }}, (res) => {{
  let b = '';
  res.on('data', (c) => b += c);
  res.on('end', () => console.log('HTTP', res.statusCode, b.length));
}}).on('error', (e) => console.error(e.message));
"""

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(env["VPS_HOST"], port=int(env.get("VPS_PORT", "22")), username=env["VPS_USER"], password=env["VPS_SSH_PASSWORD"], timeout=30)
b64 = base64.b64encode(node_simple.encode()).decode()
cmd = f"bash -lc 'cd /var/www/vouchernet && echo {b64} | base64 -d | node'"
_, o, e = c.exec_command(cmd, timeout=120)
sys.stdout.buffer.write(o.read())
sys.stdout.buffer.write(e.read())
c.close()
