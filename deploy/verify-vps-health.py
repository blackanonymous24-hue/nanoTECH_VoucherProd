#!/usr/bin/env python3
"""Vérification rapide santé VPS après réparation."""
from __future__ import annotations

import re
import sys
from pathlib import Path

import paramiko

DEPLOY_DIR = Path(__file__).resolve().parent


def load_env() -> dict[str, str]:
    out: dict[str, str] = {}
    for line in (DEPLOY_DIR / "vps.local.env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"([A-Za-z_][A-Za-z0-9_]*)=(.*)", line)
        if m:
            out[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return out


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    env = load_env()
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(
        env["VPS_HOST"],
        port=int(env.get("VPS_PORT", "22")),
        username=env.get("VPS_USER", "root"),
        password=env["VPS_SSH_PASSWORD"],
        timeout=30,
    )
    checks = [
        ("Comptes", """
sudo -u postgres psql -d vouchernet -t -A -c "
SELECT 'admin_settings', count(*)::text FROM admin_settings
UNION ALL SELECT 'managers', count(*)::text FROM managers
UNION ALL SELECT 'collaborateurs', count(*)::text FROM collaborateurs
UNION ALL SELECT 'vendors', count(*)::text FROM vendors
UNION ALL SELECT 'routers', count(*)::text FROM routers;"
"""),
        ("Propriétaire tables", """
sudo -u postgres psql -d vouchernet -t -A -c "
SELECT DISTINCT tableowner FROM pg_tables WHERE schemaname='public';"
"""),
        ("Colonne mikrotik_serial", """
sudo -u postgres psql -d vouchernet -t -A -c "
SELECT column_name FROM information_schema.columns
WHERE table_name='routers' AND column_name='mikrotik_serial';"
"""),
        ("API HTTP", "curl -sf -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/ && echo"),
        ("Redémarrage + logs 30s", """
systemctl restart vouchernet
sleep 5
systemctl is-active vouchernet
journalctl -u vouchernet --since '30 sec ago' --no-pager 2>&1 |
  grep -E 'must be owner|does not exist|level.:50' | tail -5 ||
  echo 'OK: pas d erreur DB propriétaire/colonne'
"""),
    ]
    for title, cmd in checks:
        print(f"\n--- {title} ---")
        _, stdout, _ = c.exec_command(cmd, timeout=60)
        stdout.channel.recv_exit_status()
        print(stdout.read().decode("utf-8", errors="replace").strip())
    c.close()


if __name__ == "__main__":
    main()
