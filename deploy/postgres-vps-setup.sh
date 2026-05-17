#!/usr/bin/env bash
# Installe PostgreSQL sur Ubuntu (VPS Hostinger) pour VoucherNet.
# Exécuter en root depuis la racine du dépôt :
#   sudo bash deploy/postgres-vps-setup.sh
#
# Mot de passe : défini par POSTGRES_VOUCHERNET_PASSWORD dans l'environnement,
# ou généré automatiquement et affiché à la fin.
set -euo pipefail

DB_NAME=vouchernet
DB_USER=vouchernet
APP_USER=vouchernet

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Relancez avec sudo : sudo bash deploy/postgres-vps-setup.sh"
  exit 1
fi

echo "==> Installation PostgreSQL"
apt-get update
apt-get install -y postgresql postgresql-contrib

systemctl enable postgresql
systemctl start postgresql

if [[ -z "${POSTGRES_VOUCHERNET_PASSWORD:-}" ]]; then
  POSTGRES_VOUCHERNET_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)"
  GENERATED=1
else
  GENERATED=0
fi

echo "==> Utilisateur et base « $DB_NAME »"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DB_USER') THEN
    CREATE ROLE $DB_USER WITH LOGIN PASSWORD '$POSTGRES_VOUCHERNET_PASSWORD';
  ELSE
    ALTER ROLE $DB_USER WITH PASSWORD '$POSTGRES_VOUCHERNET_PASSWORD';
  END IF;
END
\$\$;

SELECT 'CREATE DATABASE $DB_NAME OWNER $DB_USER'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$DB_NAME')\gexec

GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;
SQL

# PostgreSQL 15+ : droits sur le schéma public
sudo -u postgres psql -d "$DB_NAME" -v ON_ERROR_STOP=1 <<SQL
GRANT ALL ON SCHEMA public TO $DB_USER;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO $DB_USER;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO $DB_USER;
SQL

echo "==> Écoute locale uniquement (sécurité)"
PG_CONF=$(find /etc/postgresql -name postgresql.conf 2>/dev/null | head -1)
if [[ -n "$PG_CONF" ]]; then
  sed -i "s/^#*listen_addresses.*/listen_addresses = 'localhost'/" "$PG_CONF" || true
  systemctl restart postgresql
fi

DATABASE_URL="postgresql://${DB_USER}:${POSTGRES_VOUCHERNET_PASSWORD}@127.0.0.1:5432/${DB_NAME}"

echo ""
echo "=============================================="
echo "PostgreSQL est prêt."
echo ""
echo "Ajoutez dans /var/www/vouchernet/.env :"
echo ""
echo "DATABASE_URL=${DATABASE_URL}"
echo ""
if [[ "$GENERATED" -eq 1 ]]; then
  echo "(Mot de passe généré — copiez-le maintenant, il ne sera plus affiché.)"
fi
echo ""
echo "Puis, depuis /var/www/vouchernet :"
echo "  pnpm --filter @workspace/db exec drizzle-kit push"
echo "=============================================="

# Aide : écrire DATABASE_URL dans .env si le dossier app existe
ENV_FILE=/var/www/vouchernet/.env
if [[ -d /var/www/vouchernet ]]; then
  if [[ -f "$ENV_FILE" ]]; then
    if grep -q '^DATABASE_URL=' "$ENV_FILE"; then
      echo "Note : DATABASE_URL existe déjà dans $ENV_FILE — mettez-le à jour à la main."
    else
      echo "DATABASE_URL=${DATABASE_URL}" >> "$ENV_FILE"
      chown "$APP_USER:$APP_USER" "$ENV_FILE" 2>/dev/null || true
      chmod 600 "$ENV_FILE"
      echo "DATABASE_URL ajouté à $ENV_FILE"
    fi
  else
    echo "DATABASE_URL=${DATABASE_URL}" > "$ENV_FILE"
    chown "$APP_USER:$APP_USER" "$ENV_FILE" 2>/dev/null || true
    chmod 600 "$ENV_FILE"
    echo "Fichier $ENV_FILE créé avec DATABASE_URL"
  fi
fi
