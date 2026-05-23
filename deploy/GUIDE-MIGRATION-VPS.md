# Copier VoucherNet vers un autre VPS (app + base PostgreSQL)

## Prérequis

- VPS **source** : `deploy/vps.local.env` (déjà configuré — nanovoucher.com actuel)
- VPS **cible** : `deploy/vps.target.local.env` (nouveau serveur)
- Ubuntu 22.04+ sur le nouveau VPS, accès **root** SSH

## 1. Créer le fichier cible

```powershell
copy deploy\vps.target.local.env.example deploy\vps.target.local.env
```

Renseigner au minimum :

```env
TARGET_VPS_HOST=IP_DU_NOUVEAU_VPS
TARGET_VPS_SSH_PASSWORD=mot_de_passe_root
# Optionnel :
# TARGET_DOMAIN=votre-domaine.com
```

## 2. Lancer la migration

```powershell
python deploy/migrate-full-vps.py
```

Le script :

1. Dump PostgreSQL sur l’ancien VPS (`pg_dump`)
2. Télécharge le dump en local puis l’envoie sur le nouveau VPS
3. Installe Node, nginx, PostgreSQL (même mot de passe DB que la source)
4. Clone le dépôt GitHub, copie le `.env` de production
5. Restaure la base (`pg_restore`)
6. Build + redémarre `vouchernet`

Durée typique : 10–30 minutes selon la taille de la base.

## 3. DNS et HTTPS

Sur le **nouveau** VPS, pointer le domaine (enregistrement **A** `@` et `www` → nouvelle IP).

Si `TARGET_DOMAIN` est renseigné, le script tente `certbot --nginx`. Sinon, après migration :

```bash
ssh root@NOUVELLE_IP
certbot --nginx -d votre-domaine.com -d www.votre-domaine.com
```

## 4. Couper l’ancien serveur

Quand le nouveau site fonctionne (login admin, routeurs, ventes) :

- Mettre à jour `deploy/vps.local.env` avec la **nouvelle** IP pour les déploiements futurs
- Ou garder l’ancien VPS en secours quelques jours

## Dépannage

| Problème | Action |
|----------|--------|
| `TARGET_VPS_HOST manquant` | Créer `vps.target.local.env` |
| `pg_restore` warnings | Normal si objets déjà absents ; vérifier `SELECT COUNT(*) FROM admin_settings` |
| HTTP 000 après migration | `systemctl status vouchernet` et `journalctl -u vouchernet -n 50` |
| Login impossible | Vérifier que `.env` copié contient le même `DATABASE_URL` et `SESSION_SECRET` |
