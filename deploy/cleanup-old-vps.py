#!/usr/bin/env python3
"""Supprime VoucherNet et ses traces sur l'ancien VPS (service, nginx, app, base, utilisateur)."""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DEPLOY_DIR = Path(__file__).resolve().parent
ENV_FILE = DEPLOY_DIR / "vps.old.local.env"


def load_env() -> dict[str, str]:
    if not ENV_FILE.is_file():
        print(f"Fichier manquant : {ENV_FILE}", file=sys.stderr)
        sys.exit(1)
    out: dict[str, str] = {}
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"([A-Za-z_][A-Za-z0-9_]*)=(.*)", line)
        if m:
            out[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return out


def main() -> None:
    env = load_env()
    host = env.get("OLD_VPS_HOST", "")
    user = env.get("OLD_VPS_USER", "root")
    password = env.get("OLD_VPS_SSH_PASSWORD", "")
    port = int(env.get("OLD_VPS_PORT", "22"))
    app_dir = env.get("OLD_VPS_APP_DIR", "/var/www/vouchernet")

    if not host or not password:
        print("Renseignez OLD_VPS_HOST et OLD_VPS_SSH_PASSWORD dans deploy/vps.old.local.env", file=sys.stderr)
        sys.exit(1)

    try:
        import paramiko
    except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "paramiko", "-q"])
        import paramiko

    cleanup_script = f"""set -e
echo "==> Arrêt service vouchernet"
systemctl stop vouchernet 2>/dev/null || true
systemctl disable vouchernet 2>/dev/null || true
rm -f /etc/systemd/system/vouchernet.service
systemctl daemon-reload

echo "==> Nginx (site nanovoucher)"
rm -f /etc/nginx/sites-enabled/nanovoucher
rm -f /etc/nginx/sites-available/nanovoucher
if command -v nginx >/dev/null; then
  nginx -t 2>/dev/null && systemctl reload nginx || true
fi

echo "==> Certificats Let's Encrypt (nanovoucher.com)"
if command -v certbot >/dev/null; then
  certbot delete --cert-name nanovoucher.com --non-interactive 2>/dev/null || true
  certbot delete --cert-name www.nanovoucher.com --non-interactive 2>/dev/null || true
fi
rm -rf /etc/letsencrypt/live/nanovoucher.com 2>/dev/null || true
rm -rf /etc/letsencrypt/archive/nanovoucher.com 2>/dev/null || true
rm -rf /etc/letsencrypt/renewal/nanovoucher.com.conf 2>/dev/null || true

echo "==> Base PostgreSQL vouchernet"
if command -v psql >/dev/null && systemctl is-active postgresql >/dev/null 2>&1; then
  sudo -u postgres psql -v ON_ERROR_STOP=0 <<'SQL'
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'vouchernet';
DROP DATABASE IF EXISTS vouchernet;
DROP ROLE IF EXISTS vouchernet;
SQL
fi

echo "==> Dossier application"
rm -rf {app_dir}
rm -f /tmp/vouchernet_migrate.dump /tmp/vouchernet_restore.dump 2>/dev/null || true

echo "==> Utilisateur système vouchernet"
if id vouchernet >/dev/null 2>&1; then
  userdel -r vouchernet 2>/dev/null || userdel vouchernet 2>/dev/null || true
fi

echo "==> Vérification"
echo -n "Service vouchernet: "
systemctl is-active vouchernet 2>/dev/null || echo "inactif/absent"
echo -n "Dossier app: "
test -d {app_dir} && echo "ENCORE PRESENT" || echo "supprimé"
echo -n "DB vouchernet: "
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='vouchernet'" 2>/dev/null | grep -q 1 && echo "existe" || echo "supprimée"
echo ""
echo "Nettoyage terminé sur $(hostname -I | awk '{{print $1}}')."
"""

    print(f"==> Connexion ancien VPS {user}@{host}")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, port=port, username=user, password=password, timeout=60)
    try:
        stdin, stdout, stderr = client.exec_command(f"bash -s << 'CLEANEOF'\n{cleanup_script}\nCLEANEOF", timeout=300)
        out = stdout.read().decode(errors="replace")
        err = stderr.read().decode(errors="replace")
        code = stdout.channel.recv_exit_status()
        if out:
            print(out)
        if err:
            print(err, file=sys.stderr)
        if code != 0:
            print(f"Code sortie distant : {code}", file=sys.stderr)
            sys.exit(code)
    finally:
        client.close()

    print("Ancien VPS nettoyé — VoucherNet retiré de 69.62.110.53")


if __name__ == "__main__":
    main()
