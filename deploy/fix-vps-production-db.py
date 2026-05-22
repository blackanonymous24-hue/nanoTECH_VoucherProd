#!/usr/bin/env python3
"""Répare la base production VPS : timezone_offset_minutes + ports VPN 2520. Ne touche pas aux comptes."""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DEPLOY_DIR = Path(__file__).resolve().parent
ENV_FILE = DEPLOY_DIR / "vps.local.env"

SQL = r"""
ALTER TABLE routers
  ADD COLUMN IF NOT EXISTS timezone_offset_minutes integer NOT NULL DEFAULT 0;

UPDATE routers
SET port = 2520
WHERE port = 8728
  AND (
    host LIKE '%.mikroot.com'
    OR host IN ('vpn.nanotechvpn.com', 'vpn.wifi225.com')
  );
"""


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


def main() -> None:
    env = load_env()
    host = env.get("VPS_HOST")
    password = env.get("VPS_SSH_PASSWORD", "")
    user = env.get("VPS_USER", "root")
    port = int(env.get("VPS_PORT", "22"))
    if not password:
        print("VPS_SSH_PASSWORD manquant", file=sys.stderr)
        sys.exit(1)
    ensure_paramiko()
    import paramiko

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, port=port, username=user, password=password, timeout=30)
    try:
        print("==> Sauvegarde rapide (pg_dump routers + admin_settings)")
        _, stdout, _ = client.exec_command(
            "sudo -u postgres pg_dump -d vouchernet -t routers -t admin_settings -t vendors -t managers -t collaborateurs -Fc -f /tmp/vouchernet-accounts-backup.dump && ls -la /tmp/vouchernet-accounts-backup.dump",
            timeout=120,
        )
        print(stdout.read().decode(errors="replace"))

        print("==> Migration SQL (timezone + ports VPN)")
        for stmt in (
            "ALTER TABLE routers ADD COLUMN IF NOT EXISTS timezone_offset_minutes integer NOT NULL DEFAULT 0",
            "UPDATE routers SET port = 2520 WHERE port = 8728 AND (host LIKE '%.mikroot.com' OR host IN ('vpn.nanotechvpn.com', 'vpn.wifi225.com'))",
        ):
            _, stdout, stderr = client.exec_command(
                f"sudo -u postgres psql -d vouchernet -v ON_ERROR_STOP=1 -c {stmt!r}",
                timeout=60,
            )
            out = stdout.read().decode(errors="replace")
            err = stderr.read().decode(errors="replace")
            print(out or err)

        print("==> Vérification")
        _, stdout, _ = client.exec_command(
            "sudo -u postgres psql -d vouchernet -t -A -c \"SELECT column_name FROM information_schema.columns WHERE table_name='routers' AND column_name='timezone_offset_minutes';\" && "
            "sudo -u postgres psql -d vouchernet -t -A -c \"SELECT port, count(*) FROM routers GROUP BY port ORDER BY port;\" && "
            "sudo -u postgres psql -d vouchernet -t -A -c \"SELECT id, host, port FROM routers WHERE host LIKE '%mikroot%' LIMIT 5;\"",
            timeout=30,
        )
        print(stdout.read().decode(errors="replace"))

        print("==> Redémarrage vouchernet")
        _, stdout, _ = client.exec_command("systemctl restart vouchernet && sleep 2 && systemctl is-active vouchernet", timeout=30)
        print(stdout.read().decode(errors="replace"))
        print("Terminé — comptes et données métier conservés (dump dans /tmp/vouchernet-accounts-backup.dump sur le VPS).")
    finally:
        client.close()


if __name__ == "__main__":
    main()
