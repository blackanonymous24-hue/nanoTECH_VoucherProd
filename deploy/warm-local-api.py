#!/usr/bin/env python3
import json, re, sys
from pathlib import Path
import paramiko

env: dict[str, str] = {}
for line in Path(__file__).resolve().parent.joinpath("vps.local.env").read_text(encoding="utf-8").splitlines():
    m = re.match(r"([A-Za-z_][A-Za-z0-9_]*)=(.*)", line.strip())
    if m:
        env[m.group(1)] = m.group(2).strip().strip('"').strip("'")

node = """
const http = require('http');
function get(id, label) {
  return new Promise((resolve) => {
    http.get({ hostname: '127.0.0.1', port: 3001, path: '/api/routers/' + id + '/dashboard-priority' }, (res) => {
      let b = '';
      res.on('data', (c) => b += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(b);
          const s = j.sales || {};
          console.log(label, 'status', res.statusCode,
            'daily', s.dailyCount, s.dailyAmount,
            'monthly', s.monthlyCount, s.monthlyAmount,
            'clock', (j.info || {}).clockDate);
        } catch (e) { console.log(label, 'parse err', b.slice(0, 200)); }
        resolve();
      });
    }).on('error', (e) => { console.log(label, e.message); resolve(); });
  });
}
(async () => {
  await get(44, 'CITY');
  await get(11, 'DIOUF');
})();
"""

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(env["VPS_HOST"], port=int(env.get("VPS_PORT", "22")), username=env["VPS_USER"], password=env["VPS_SSH_PASSWORD"], timeout=30)
_, o, e = c.exec_command(f"bash -lc 'cd /var/www/vouchernet && node -e {json.dumps(node)}'", timeout=180)
sys.stdout.buffer.write(o.read())
sys.stdout.buffer.write(e.read())
c.close()
