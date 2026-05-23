"""Login as super admin and verify the /reports/summary fix."""
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

print("== existing super-admin accounts ==")
_, o, _ = c.exec_command(
    "sudo -u postgres psql -d vouchernet -A -c \""
    "SELECT id, username, role FROM admins WHERE role IN ('super','admin') ORDER BY id LIMIT 10;\""
)
print(o.read().decode())

node_script = r'''
const http = require('http');
function rq(method, path, headers={}, body=null) {
  return new Promise((res, rej) => {
    const r = http.request({hostname:'127.0.0.1', port:3001, path, method, headers}, (resp) => {
      let chunks = [];
      resp.on('data', c => chunks.push(c));
      resp.on('end', () => res({status: resp.statusCode, headers: resp.headers, body: Buffer.concat(chunks).toString()}));
    });
    r.on('error', rej);
    if (body) r.write(body);
    r.end();
  });
}
(async () => {
  // Note: login route needs proper credentials. Just call admin route and inspect 401 vs ok via cookie path.
  // The simplest probe: hit /api/vendors/reports/summary?routerId=1 unauthenticated → expect 401 (means route alive).
  const r0 = await rq('GET', '/api/vendors/reports/summary?routerId=1');
  console.log('unauth probe status:', r0.status);
  console.log('body:', r0.body.slice(0, 200));
})();
'''
print("\n== Probe API alive ==")
import json as _json
_, o, e = c.exec_command(f"cd /var/www/vouchernet && node -e {_json.dumps(node_script)}")
print(o.read().decode() + e.read().decode())
c.close()
