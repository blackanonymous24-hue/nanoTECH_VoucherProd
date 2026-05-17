#!/usr/bin/env bash
# Bootstrap VPS vierge — à lancer EN ROOT depuis /var/www/vouchernet (projet déjà copié).
#   cd /var/www/vouchernet && bash deploy/bootstrap-vierge.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Exécutez en root : sudo bash deploy/bootstrap-vierge.sh"
  exit 1
fi

echo "=== 1/5 Mise à jour système ==="
apt-get update
apt-get upgrade -y
apt-get install -y git curl

echo "=== 2/5 Node, nginx, utilisateur ==="
bash deploy/hostinger-vps-setup.sh

echo "=== 3/5 PostgreSQL ==="
bash deploy/postgres-vps-setup.sh

ENV_FILE=/var/www/vouchernet/.env
if [[ -f "$ENV_FILE" ]] && ! grep -q '^SESSION_SECRET=' "$ENV_FILE"; then
  SECRET=$(openssl rand -hex 32)
  echo "SESSION_SECRET=$SECRET" >> "$ENV_FILE"
  echo "NODE_ENV=production" >> "$ENV_FILE"
  echo "PORT=3001" >> "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "SESSION_SECRET généré dans $ENV_FILE"
fi

echo "=== 4/5 Build application (peut prendre plusieurs minutes) ==="
chown -R vouchernet:vouchernet /var/www/vouchernet
sudo -u vouchernet bash -lc "cd /var/www/vouchernet && pnpm install --frozen-lockfile && pnpm build"
sudo -u vouchernet bash -lc "cd /var/www/vouchernet && pnpm --filter @workspace/db exec drizzle-kit push"

echo "=== 5/5 Démarrage service ==="
systemctl enable --now vouchernet

echo ""
echo "Bootstrap terminé."
echo "  - Test : curl -s http://127.0.0.1:3001/ | head"
echo "  - Pare-feu : ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw enable"
echo "  - HTTPS  : certbot --nginx -d nanovoucher.com -d www.nanovoucher.com"
echo "  - Site   : https://nanovoucher.com"
