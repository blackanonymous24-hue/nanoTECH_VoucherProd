#!/usr/bin/env python3
"""Supprime nanotech-vpn du VPS cible et active Nginx VoucherNet (nanovoucher.com)."""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

DEPLOY_DIR = Path(__file__).resolve().parent
TARGET_ENV = DEPLOY_DIR / "vps.target.local.env"
DOMAIN = "nanovoucher.com"


def load_env(path: Path) -> dict[str, str]:
    if not path.is_file():
        print(f"Fichier manquant : {path}", file=sys.stderr)
        sys.exit(1)
    out: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"([A-Za-z_][A-Za-z0-9_]*)=(.*)", line)
        if m:
            out[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return out


def main() -> None:
    env = load_env(TARGET_ENV)
    host = env.get("TARGET_VPS_HOST") or env.get("VPS_HOST", "")
    user = env.get("TARGET_VPS_USER") or env.get("VPS_USER", "root")
    password = env.get("TARGET_VPS_SSH_PASSWORD") or env.get("VPS_SSH_PASSWORD", "")
    port = int(env.get("TARGET_VPS_PORT") or env.get("VPS_PORT", "22"))
    app_dir = env.get("TARGET_VPS_APP_DIR") or env.get("VPS_APP_DIR", "/var/www/vouchernet")

    if not host or not password:
        print("Renseignez TARGET_VPS_HOST et TARGET_VPS_SSH_PASSWORD dans deploy/vps.target.local.env", file=sys.stderr)
        sys.exit(1)

    try:
        import paramiko
    except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "paramiko", "-q"])
        import paramiko

    cleanup_script = f"""set -e
echo "==> Arrêt et suppression nanotech-vpn (systemd)"
systemctl stop nanotech-vpn 2>/dev/null || true
systemctl disable nanotech-vpn 2>/dev/null || true
rm -f /etc/systemd/system/nanotech-vpn.service
systemctl daemon-reload

echo "==> Nginx : retirer nanotech-vpn, activer VoucherNet"
rm -f /etc/nginx/sites-enabled/nanotech-vpn
rm -f /etc/nginx/sites-available/nanotech-vpn
rm -f /etc/nginx/sites-enabled/default
# Certificats VPN (nanotechvpn.com etc.)
for cert in nanotechvpn.com www.nanotechvpn.com vpn.nanotechvpn.com; do
  certbot delete --cert-name "$cert" --non-interactive 2>/dev/null || true
done

if [[ -f {app_dir}/deploy/nginx-nanovoucher.conf ]]; then
  cp {app_dir}/deploy/nginx-nanovoucher.conf /etc/nginx/sites-available/nanovoucher
else
  echo "WARN: nginx-nanovoucher.conf introuvable dans {app_dir}"
fi
ln -sf /etc/nginx/sites-available/nanovoucher /etc/nginx/sites-enabled/nanovoucher
nginx -t
systemctl reload nginx

echo "==> Docker (conteneurs / stacks nanotech)"
if command -v docker >/dev/null; then
  docker ps -a --format '{{{{.Names}}}}' 2>/dev/null | grep -iE 'nanotech|vpn' | while read -r n; do
    docker rm -f "$n" 2>/dev/null || true
  done
  for d in /var/www/nanotech-vpn /opt/nanotech-vpn /root/nanotech-vpn /home/nanotech/nanotech-vpn; do
    if [[ -d "$d" && -f "$d/docker-compose.yml" || -f "$d/docker-compose.yaml" ]]; then
      (cd "$d" && docker compose down -v 2>/dev/null) || (cd "$d" && docker-compose down -v 2>/dev/null) || true
    fi
  done
fi

echo "==> Dossiers application nanotech-vpn"
rm -rf /var/www/nanotech-vpn /opt/nanotech-vpn /root/nanotech-vpn
rm -rf /home/nanotech/nanotech-vpn 2>/dev/null || true
if id nanotech >/dev/null 2>&1; then
  userdel -r nanotech 2>/dev/null || userdel nanotech 2>/dev/null || true
fi

echo "==> Vérification services"
echo -n "nanotech-vpn: "
systemctl is-active nanotech-vpn 2>/dev/null || echo "absent/inactif"
echo -n "vouchernet: "
systemctl is-active vouchernet 2>/dev/null || echo "inactif"
echo -n "sites nginx enabled: "
ls -1 /etc/nginx/sites-enabled/ 2>/dev/null | tr '\\n' ' '
echo ""

echo "==> Certbot HTTPS {DOMAIN}"
certbot --nginx -d {DOMAIN} -d www.{DOMAIN} --non-interactive --agree-tos --redirect \\
  -m admin@{DOMAIN} || echo "WARN: certbot a échoué (vérifiez DNS A @ et www -> cette IP)"

echo "==> Test local"
curl -s -o /dev/null -w "vouchernet:3001=%{{http_code}}\\n" http://127.0.0.1:3001/ || true
curl -s -o /dev/null -w "nginx:80=%{{http_code}}\\n" -H "Host: {DOMAIN}" http://127.0.0.1/ || true
"""

    print(f"==> Connexion {user}@{host}")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, port=port, username=user, password=password, timeout=60)
    try:
        stdin, stdout, stderr = client.exec_command(f"bash -s << 'CLEANEOF'\n{cleanup_script}\nCLEANEOF", timeout=600)
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

    print(f"Terminé — nanotech-vpn retiré, VoucherNet sur https://{DOMAIN} (si DNS pointe vers {host})")


if __name__ == "__main__":
    main()
