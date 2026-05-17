#!/usr/bin/env bash
# Configuration initiale VPS Hostinger (Ubuntu 22.04 / 24.04)
# Exécuter en root : bash deploy/hostinger-vps-setup.sh
set -euo pipefail

APP_DIR=/var/www/vouchernet
APP_USER=vouchernet

echo "==> Paquets système"
apt-get update
apt-get install -y curl git nginx certbot python3-certbot-nginx \
  build-essential chromium-browser fonts-liberation || \
  apt-get install -y chromium fonts-liberation

echo "==> Node.js 22"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "==> pnpm (corepack)"
corepack enable
corepack prepare pnpm@10.26.1 --activate

echo "==> Utilisateur applicatif"
id -u "$APP_USER" &>/dev/null || useradd -r -m -d "$APP_DIR" -s /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo "==> Nginx (site nanovoucher)"
if [[ -f deploy/nginx-nanovoucher.conf ]]; then
  cp deploy/nginx-nanovoucher.conf /etc/nginx/sites-available/nanovoucher
  ln -sf /etc/nginx/sites-available/nanovoucher /etc/nginx/sites-enabled/nanovoucher
  rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
  nginx -t
  systemctl enable nginx
  systemctl reload nginx
fi

echo "==> systemd"
if [[ -f deploy/vouchernet.service ]]; then
  cp deploy/vouchernet.service /etc/systemd/system/vouchernet.service
  systemctl daemon-reload
fi

echo ""
echo "Étapes suivantes (en tant que $APP_USER ou depuis $APP_DIR) :"
echo "  1. Cloner le dépôt dans $APP_DIR"
echo "  2. cp deploy/env.production.example $APP_DIR/.env && nano $APP_DIR/.env"
echo "  3. cd $APP_DIR && pnpm install --frozen-lockfile && pnpm build"
echo "  4. sudo bash deploy/postgres-vps-setup.sh   # PostgreSQL local"
echo "  5. pnpm --filter @workspace/db exec drizzle-kit push"
echo "  6. sudo systemctl enable --now vouchernet"
echo "  7. sudo certbot --nginx -d nanovoucher.com -d www.nanovoucher.com"
echo ""
echo "DNS Hostinger : enregistrement A @ et www -> IP du VPS"
