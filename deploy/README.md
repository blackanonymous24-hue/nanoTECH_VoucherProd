# Déploiement VPS Hostinger — VoucherNet

Stack : **un seul processus Node** (`artifacts/api-server`) qui sert l’API `/api/*` et le front Vite compilé (`artifacts/app/dist/public`). Nginx fait le HTTPS et le reverse proxy.

L’APK mobile pointe vers `https://nanovoucher.com` — ce domaine doit viser le VPS.

## Prérequis

| Élément | Détail |
|--------|--------|
| VPS | Ubuntu 22.04+ (Hostinger KVM) |
| RAM | 2 Go minimum recommandé |
| Domaine | `nanovoucher.com` → IP du VPS (DNS A / AAAA) |
| Base | PostgreSQL **sur le VPS** (script fourni) ou Neon |
| Ports sortants | API MikroTik **8728** vers vos routeurs |

## 1. Première installation sur le VPS

Connectez-vous en SSH (utilisateur root ou sudo) :

```bash
cd /var/www
git clone https://VOTRE_REPO.git vouchernet
cd vouchernet
bash deploy/hostinger-vps-setup.sh
```

## 2. Installer PostgreSQL sur le VPS (recommandé)

Connecté en SSH **en root** (ou avec `sudo`), depuis le dossier du projet :

```bash
cd /var/www/vouchernet
sudo bash deploy/postgres-vps-setup.sh
```

Le script :
- installe PostgreSQL (`apt install postgresql`)
- crée l’utilisateur `vouchernet` et la base `vouchernet`
- génère un mot de passe (affiché une fois) ou utilise `POSTGRES_VOUCHERNET_PASSWORD` si vous le définissez avant :
  ```bash
  export POSTGRES_VOUCHERNET_PASSWORD='MonMotDePasseSecurise123'
  sudo bash deploy/postgres-vps-setup.sh
  ```
- écrit `DATABASE_URL` dans `/var/www/vouchernet/.env` si possible
- n’écoute que sur **localhost** (pas exposé sur Internet)

Vérifier que Postgres tourne :

```bash
sudo systemctl status postgresql
sudo -u postgres psql -c '\l' | grep vouchernet
```

### Installation manuelle (si vous préférez taper les commandes)

```bash
sudo apt update
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable postgresql
sudo systemctl start postgresql

sudo -u postgres psql
```

Dans le shell `psql` :

```sql
CREATE USER vouchernet WITH PASSWORD 'VOTRE_MOT_DE_PASSE';
CREATE DATABASE vouchernet OWNER vouchernet;
\q
```

Puis dans `.env` :

```
DATABASE_URL=postgresql://vouchernet:VOTRE_MOT_DE_PASSE@127.0.0.1:5432/vouchernet
```

## 3. Variables d’environnement

```bash
cp deploy/env.production.example /var/www/vouchernet/.env
nano /var/www/vouchernet/.env
chmod 600 /var/www/vouchernet/.env
chown vouchernet:vouchernet /var/www/vouchernet/.env
```

Générer `SESSION_SECRET` :

```bash
openssl rand -hex 32
```

## 4. Build et schéma base

En tant qu’utilisateur `vouchernet` (ou avec `sudo -u vouchernet`) :

```bash
cd /var/www/vouchernet
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @workspace/db exec drizzle-kit push
```

## 5. Démarrer le service

```bash
sudo systemctl enable --now vouchernet
sudo systemctl status vouchernet
journalctl -u vouchernet -f
```

Test local sur le VPS : `curl -s http://127.0.0.1:3001/ | head`

## 6. HTTPS (Let’s Encrypt)

```bash
sudo certbot --nginx -d nanovoucher.com -d www.nanovoucher.com
```

Renouvellement automatique : géré par certbot.

## 7. Mises à jour

### Depuis le VPS (SSH)

```bash
sudo bash /var/www/vouchernet/deploy/update-vps.sh
```

### Depuis votre PC (automatique)

1. Copier `deploy/vps.local.env.example` → `deploy/vps.local.env` (ce fichier est **ignoré par Git**).
2. Renseigner `VPS_HOST`, `VPS_USER`, et de préférence `VPS_SSH_KEY` (clé SSH, pas le mot de passe en clair).
3. Installer votre clé publique sur le VPS une fois :
   ```powershell
   type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh root@VOTRE_IP "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
   ```
4. Lancer :
   ```powershell
   .\deploy\deploy-local.ps1
   ```

Le script fait `git push` puis exécute `update-vps.sh` sur le serveur. Quand vous demandez une mise à jour à l’assistant Cursor, il pourra utiliser ce fichier local (jamais commité).

**Sécurité :** ne mettez pas le mot de passe VPS dans le dépôt Git. Utilisez une clé SSH ; le mot de passe ne sert qu’une fois pour la copier sur le serveur.

## DNS Hostinger (hPanel)

1. **Domaines** → `nanovoucher.com` → **DNS / Zone**
2. Enregistrement **A** : `@` → IP du VPS
3. Enregistrement **A** ou **CNAME** : `www` → IP du VPS (ou `@`)

Propagation : quelques minutes à 24 h.

## Pare-feu

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
```

Ne pas exposer le port **3001** publiquement si Nginx est devant (écoute localhost uniquement).

## Dépannage

| Problème | Piste |
|----------|--------|
| 502 Bad Gateway | `systemctl status vouchernet`, logs `journalctl -u vouchernet` |
| Page blanche | Vérifier `artifacts/app/dist/public` existe après `pnpm build` |
| Login échoue | `DATABASE_URL`, `drizzle-kit push`, `sudo systemctl status postgresql` |
| `connection refused` Postgres | `sudo systemctl start postgresql`, URL doit être `127.0.0.1` |
| Routeurs injoignables | Pare-feu VPS + IP publique routeur + port 8728 |

## APK mobile

Après déploiement web OK, rebuild EAS si besoin ; l’URL `https://nanovoucher.com` est déjà la prod par défaut dans `artifacts/mobile`.
