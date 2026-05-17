# Guide complet — VPS Hostinger vierge → nanovoucher.com

DNS OK : `nanovoucher.com` → **69.62.110.53**

Ce guide part d’un VPS Ubuntu **sans rien d’installé**.

---

## Étape 0 — Connexion SSH

### Depuis Windows (PowerShell ou CMD)

```powershell
ssh root@69.62.110.53
```

- Mot de passe : celui affiché dans **Hostinger → VPS → Aperçu → Mot de passe root** (ou clé SSH si vous en avez créé une).
- Première connexion : tapez `yes` si on demande de faire confiance à l’empreinte.

### Depuis hPanel Hostinger

**VPS → Votre serveur → Terminal du navigateur** (connexion directe sans logiciel).

---

## Étape 1 — Mise à jour du système

```bash
apt update && apt upgrade -y
apt install -y git curl
```

---

## Étape 2 — Copier le projet sur le VPS

### Option A — Dépôt Git (recommandé si le code est sur GitHub/GitLab)

```bash
mkdir -p /var/www
cd /var/www
git clone https://VOTRE_URL_DU_DEPOT.git vouchernet
cd vouchernet
```

Remplacez `VOTRE_URL_DU_DEPOT` par l’URL réelle (HTTPS ou SSH).

### Option B — Copie depuis votre PC Windows (sans Git sur le serveur)

Sur **votre PC**, dans le dossier du projet :

```powershell
scp -r "D:\nanoTECH Project\TEST\nanoTECH_VoucherProd-main\nanoTECH_VoucherProd-main\nanoTECH_VoucherProd" root@69.62.110.53:/var/www/vouchernet
```

Puis sur le VPS :

```bash
cd /var/www/vouchernet
```

---

## Étape 3 — Installation automatique (Node, nginx, utilisateur)

Toujours sur le VPS, **dans** `/var/www/vouchernet` :

```bash
cd /var/www/vouchernet
bash deploy/hostinger-vps-setup.sh
```

Cela installe : Node.js 22, pnpm, nginx, utilisateur `vouchernet`, service systemd.

---

## Étape 4 — PostgreSQL sur le VPS

```bash
cd /var/www/vouchernet
bash deploy/postgres-vps-setup.sh
```

**Notez le mot de passe affiché** (ou définissez-le avant) :

```bash
export POSTGRES_VOUCHERNET_PASSWORD='UnMotDePasseTresLong123!'
bash deploy/postgres-vps-setup.sh
```

Le script crée la base `vouchernet` et ajoute `DATABASE_URL` dans `.env`.

---

## Étape 5 — Fichier `.env` (secrets)

```bash
nano /var/www/vouchernet/.env
```

Contenu minimum :

```env
NODE_ENV=production
PORT=3001
DATABASE_URL=postgresql://vouchernet:VOTRE_MOT_DE_PASSE@127.0.0.1:5432/vouchernet
SESSION_SECRET=COLLER_ICI_64_CARACTERES_HEX
```

Générer `SESSION_SECRET` sur le VPS :

```bash
openssl rand -hex 32
```

Sauvegarder : `Ctrl+O`, Entrée, `Ctrl+X`.

```bash
chmod 600 /var/www/vouchernet/.env
chown vouchernet:vouchernet /var/www/vouchernet/.env
```

---

## Étape 6 — Build de l’application

```bash
cd /var/www/vouchernet
chown -R vouchernet:vouchernet /var/www/vouchernet
sudo -u vouchernet bash -lc 'cd /var/www/vouchernet && pnpm install --frozen-lockfile && pnpm build'
sudo -u vouchernet bash -lc 'cd /var/www/vouchernet && pnpm --filter @workspace/db exec drizzle-kit push'
```

La première commande peut prendre **5 à 15 minutes**.

---

## Étape 7 — Démarrer l’application

```bash
systemctl enable --now vouchernet
systemctl status vouchernet
```

Test :

```bash
curl -s http://127.0.0.1:3001/ | head -5
```

Si vous voyez du HTML (`<!doctype`…), l’app tourne.

Logs en cas d’erreur :

```bash
journalctl -u vouchernet -n 50 --no-pager
```

---

## Étape 8 — Pare-feu

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
ufw status
```

---

## Étape 9 — HTTPS (certificat gratuit)

```bash
certbot --nginx -d nanovoucher.com -d www.nanovoucher.com
```

- Email : le vôtre (alertes expiration)
- Accepter les conditions
- Redirection HTTP → HTTPS : **Oui (2)**

Ouvrez : **https://nanovoucher.com**

Login par défaut (base vide) : `admin` / `root` — **changez le mot de passe tout de suite**.

---

## Récapitulatif des commandes (copier-coller)

```bash
apt update && apt upgrade -y && apt install -y git curl
mkdir -p /var/www && cd /var/www
# → git clone OU scp depuis le PC
cd /var/www/vouchernet
bash deploy/hostinger-vps-setup.sh
bash deploy/postgres-vps-setup.sh
nano /var/www/vouchernet/.env
chown -R vouchernet:vouchernet /var/www/vouchernet
sudo -u vouchernet bash -lc 'cd /var/www/vouchernet && pnpm install --frozen-lockfile && pnpm build'
sudo -u vouchernet bash -lc 'cd /var/www/vouchernet && pnpm --filter @workspace/db exec drizzle-kit push'
systemctl enable --now vouchernet
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable
certbot --nginx -d nanovoucher.com -d www.nanovoucher.com
```

---

## Dépannage rapide

| Symptôme | Action |
|----------|--------|
| `ssh: Connection refused` | Vérifier IP VPS dans Hostinger, pare-feu hPanel |
| `pnpm: command not found` | Relancer `hostinger-vps-setup.sh` |
| `502 Bad Gateway` | `systemctl restart vouchernet` + `journalctl -u vouchernet` |
| Site sans HTTPS | Relancer `certbot --nginx` |
| Erreur base de données | `systemctl status postgresql`, vérifier `DATABASE_URL` |

---

## Après le déploiement

- APK mobile : URL `https://nanovoucher.com` (déjà configurée)
- Mises à jour : `git pull` → `pnpm install` → `pnpm build` → `systemctl restart vouchernet`
