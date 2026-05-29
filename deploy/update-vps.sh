#!/usr/bin/env bash
# Mise à jour production depuis GitHub — à lancer en root sur le VPS :
#   sudo bash deploy/update-vps.sh
set -euo pipefail

APP_DIR=/var/www/vouchernet
APP_USER=vouchernet
BRANCH="${VOUCHERNET_BRANCH:-main}"

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Relancez en root : sudo bash deploy/update-vps.sh"
  exit 1
fi

if [[ ! -d "$APP_DIR/.git" ]]; then
  echo "Erreur : $APP_DIR n'est pas un dépôt git."
  exit 1
fi

cd "$APP_DIR"

echo "==> git pull origin $BRANCH"
git fetch origin "$BRANCH"
git pull origin "$BRANCH"

echo "==> pnpm install + build"
sudo -u "$APP_USER" bash -lc "cd $APP_DIR && pnpm install --frozen-lockfile && pnpm build"

if [[ -f "$APP_DIR/deploy/vouchernet.service" ]]; then
  cp "$APP_DIR/deploy/vouchernet.service" /etc/systemd/system/vouchernet.service
  systemctl daemon-reload
fi

echo "==> migrations base (drizzle)"
sudo -u "$APP_USER" bash -lc "cd $APP_DIR && pnpm --filter @workspace/db exec drizzle-kit push" || true

echo "==> nginx (static direct + API proxy)"
if [[ -f "$APP_DIR/deploy/nginx-nanovoucher.conf" ]]; then
  cp "$APP_DIR/deploy/nginx-nanovoucher.conf" /etc/nginx/sites-available/nanovoucher
  ln -sf /etc/nginx/sites-available/nanovoucher /etc/nginx/sites-enabled/nanovoucher
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl reload nginx
  if command -v certbot >/dev/null; then
    certbot --nginx -d nanovoucher.com -d www.nanovoucher.com \
      --non-interactive --agree-tos --redirect -m admin@nanovoucher.com 2>/dev/null || true
    nginx -t
    systemctl reload nginx
  fi
fi

echo "==> redémarrage service"
systemctl restart vouchernet
sleep 2
systemctl is-active --quiet vouchernet

echo ""
echo "Mise à jour OK — $(date -Iseconds)"
echo "  https://nanovoucher.com"
curl -sf -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:3001/ || echo "(vérifiez journalctl -u vouchernet)"
