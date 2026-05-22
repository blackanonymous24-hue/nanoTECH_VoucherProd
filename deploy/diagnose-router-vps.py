#!/usr/bin/env python3
"""Diagnostic VPS : config app, routeurs en base, connectivité TCP API MikroTik."""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DEPLOY_DIR = Path(__file__).resolve().parent
ENV_FILE = DEPLOY_DIR / "vps.local.env"


def load_env() -> dict[str, str]:
    out: dict[str, str] = {}
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"([A-Za-z_][A-Za-z0-9_]*)=(.*)", line)
        if m:
            out[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return out


def ensure_paramiko():
    try:
        import paramiko  # noqa: F401
    except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "paramiko", "-q"])


REMOTE_SH = r"""
set -e
APP_DIR="${VPS_APP_DIR:-/var/www/vouchernet}"
echo "==> App dir + git"
cd "$APP_DIR"
git log -1 --oneline 2>/dev/null || echo "(no git)"
echo "---"
echo "==> Service vouchernet"
systemctl is-active vouchernet 2>/dev/null || true
systemctl status vouchernet --no-pager -n 3 2>&1 | head -12
echo "---"
echo "==> .env (masqué)"
if [ -f .env ]; then
  grep -E '^(NODE_ENV|PORT|DATABASE_URL|SESSION_SECRET|ROUTER_)=' .env 2>/dev/null | sed -E 's#(postgresql://[^:]+:)[^@]+#\1***#;s/(SESSION_SECRET=).*/\1***/' || true
else
  echo "MISSING .env"
fi
echo "---"
echo "==> UFW / iptables sortant"
ufw status 2>/dev/null | head -5 || echo "ufw N/A"
iptables -L OUTPUT -n 2>/dev/null | head -8 || true
echo "---"
echo "==> Routeurs (host, port) — 30 premiers"
sudo -u postgres psql -d vouchernet -t -A -c \
  "SELECT id, left(name,24), host, port FROM routers ORDER BY id LIMIT 30;" 2>/dev/null \
  || psql "$DATABASE_URL" -t -A -c \
  "SELECT id, left(name,24), host, port FROM routers ORDER BY id LIMIT 30;" 2>/dev/null \
  || echo "psql failed"
echo "---"
echo "==> Hosts avec :port encore dans host"
sudo -u postgres psql -d vouchernet -t -A -c \
  "SELECT id, host, port FROM routers WHERE host LIKE '%:%' LIMIT 20;" 2>/dev/null || true
echo "---"
echo "==> Colonne timezone_offset_minutes"
sudo -u postgres psql -d vouchernet -t -A -c \
  "SELECT column_name FROM information_schema.columns WHERE table_name='routers' AND column_name='timezone_offset_minutes';" 2>/dev/null || true
echo "---"
echo "==> Test TCP depuis VPS (timeout 5s) — top 8 routeurs"
python3 << 'PY'
import socket, subprocess, os
def get_rows():
    q = "SELECT id, host, port FROM routers ORDER BY id LIMIT 8;"
    for cmd in [
        ['sudo','-u','postgres','psql','-d','vouchernet','-t','-A','-F','|','-c',q],
        ['psql', os.environ.get('DATABASE_URL',''), '-t','-A','-F','|','-c',q],
    ]:
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
            if r.returncode == 0 and r.stdout.strip():
                for line in r.stdout.strip().splitlines():
                    parts = line.split('|')
                    if len(parts) >= 3:
                        yield int(parts[0]), parts[1].strip(), int(parts[2])
                return
        except Exception:
            pass
for rid, host, port in get_rows():
    if not host:
        continue
    if ':' in host:
        h, _, p = host.rpartition(':')
        if p.isdigit():
            host, port = h, int(p)
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(5)
    try:
        s.connect((host, port))
        ok = "OK"
    except Exception as e:
        ok = f"FAIL ({e})"
    finally:
        s.close()
    print(f"  router {rid}: {host}:{port} -> {ok}")
PY
echo "---"
echo "==> Test v1.mikroot.com:2520 et :8728"
for pair in "v1.mikroot.com 2520" "v1.mikroot.com 8728"; do
  set -- $pair
  timeout 5 bash -c "echo >/dev/tcp/$1/$2" 2>/dev/null && echo "  $1:$2 TCP OK" || echo "  $1:$2 TCP FAIL"
done
echo "---"
echo "==> Derniers logs ping/connexion routeur"
journalctl -u vouchernet --since '2h ago' --no-pager 2>/dev/null | grep -iE 'router|ping|ECONN|timeout|8728|2520' | tail -15 || true
"""


def main() -> None:
    env = load_env()
    host = env.get("VPS_HOST")
    password = env.get("VPS_SSH_PASSWORD", "")
    user = env.get("VPS_USER", "root")
    port = int(env.get("VPS_PORT", "22"))
    app_dir = env.get("VPS_APP_DIR", "/var/www/vouchernet")
    if not password:
        print("VPS_SSH_PASSWORD manquant", file=sys.stderr)
        sys.exit(1)
    ensure_paramiko()
    import paramiko

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, port=port, username=user, password=password, timeout=30)
    try:
        _, stdout, stderr = client.exec_command(
            f"export VPS_APP_DIR='{app_dir}'; {REMOTE_SH}",
            timeout=180,
        )
        out = stdout.read().decode(errors="replace")
        err = stderr.read().decode(errors="replace")
        print(out)
        if err.strip():
            print(err, file=sys.stderr)
    finally:
        client.close()


if __name__ == "__main__":
    main()
