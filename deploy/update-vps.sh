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

echo "==> migrations base (drizzle)"
sudo -u "$APP_USER" bash -lc "cd $APP_DIR && pnpm --filter @workspace/db exec drizzle-kit push" || true

echo "==> redémarrage service"
systemctl restart vouchernet
sleep 2
systemctl is-active --quiet vouchernet

echo ""
echo "Mise à jour OK — $(date -Iseconds)"
echo "  https://nanovoucher.com"
curl -sf -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:3001/ || echo "(vérifiez journalctl -u vouchernet)"
