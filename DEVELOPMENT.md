# VoucherNet — développement local (Cursor / machine)

Ce dépôt est pensé pour être développé **en local** (IDE type Cursor, VS Code), avec PostgreSQL et les deux serveurs de dev (API + Vite).

## Prérequis

- **Node.js** (LTS recommandé)
- **pnpm** : `corepack enable` puis `corepack prepare pnpm@10.26.1 --activate`, ou `npx pnpm@10.26.1 …` depuis la racine du monorepo
- **PostgreSQL** (local, Docker, **Neon**, ou autre) — variable **`DATABASE_URL`** (URI `postgresql://…`). En dev, placez-la dans un fichier **`.env`** à la racine du dépôt ou dans **`artifacts/api-server/.env`** (voir `.env.example`) : l’API charge ce fichier au démarrage. **Ne commitez jamais** `.env` ni ne partagez les mots de passe en clair ; si un secret a fuité, **régénérez-le** dans la console Neon (ou équivalent).

### Windows

Le script `preinstall` à la racine utilise **`sh`** (style Unix). Si `pnpm install` échoue, utiliser par exemple :

```powershell
npx --yes pnpm@10.26.1 install --ignore-scripts
```

…ou lancer l’install depuis **Git Bash** / **WSL** où `sh` est disponible.

Les **overrides** pnpm qui excluaient les binaires natifs optionnels **Windows** ont été assouplis pour que Vite / Tailwind / Rollup fonctionnent sur Win32. Après un clone, un `pnpm install` propre régénère les optionnels pour votre OS.

## Démarrage rapide

**API + Vite + tunnel + navigateur (téléphone / Internet)** — à la racine, après `pnpm install` et une base Postgres accessible (`DATABASE_URL` dans `.env` ou `.env.local`) :

```bash
pnpm run dev
```

Lance l’API (**3001**), Vite (**4173**, `PORT` / `vite.config.ts`), attend le front, tente **ngrok** (si `NGROK_AUTHTOKEN`) puis **cloudflared** (`trycloudflare.com`) puis **localtunnel**, affiche les URL dans le terminal, ouvre le navigateur, et arrête le tunnel avec Ctrl+C. Voir **`.env.example`** (`DEV_TUNNEL`, `NGROK_AUTHTOKEN`, `DEV_OPEN_BROWSER`). *La racine impose pnpm au `preinstall` : la commande canonique est `pnpm run dev` ; avec npm seul, `npm install` échouera souvent — utiliser `npm install --ignore-scripts` si nécessaire, puis `npm run dev`.*

**Tout-en-un avec synchro Neon (sans tunnel)** : Docker démarré, puis :

```bash
pnpm run dev:full
```

Cela exécute la synchro Neon → Postgres Docker (port **5434**), met à jour **`.env.local`**, puis lance l’API (**3001**) et Vite (**4173**). Avec tunnel + synchro : `pnpm run dev:full:tunnel`.

**Sans tunnel public** (LAN / localhost seulement) :

```bash
pnpm run dev:no-tunnel
```

Alternative : étapes séparées :

1. Créer une base PostgreSQL et exporter **`DATABASE_URL`** (PowerShell : `$env:DATABASE_URL = "postgresql://USER:PASS@HOST:PORT/DB"`).
2. Appliquer le schéma Drizzle (au besoin) :

   ```bash
   npx pnpm@10.26.1 --filter @workspace/db exec drizzle-kit push
   ```

3. **Terminal 1 — API** (port **3001** par défaut) :

   ```bash
   npx pnpm@10.26.1 --filter @workspace/api-server run dev
   ```

4. **Terminal 2 — front Vite** (port **4173** par défaut, proxy `/api` → `http://localhost:3001`) :

   ```bash
   npx pnpm@10.26.1 --filter @workspace/app run dev
   ```

5. Ouvrir l’URL affichée par Vite (souvent `http://localhost:4173/`). Compte super-admin initial documenté plus bas : **`admin` / `root`** sur base vide (seed côté API).

L’API exécute au démarrage des migrations **idempotentes** (`ensure*` dans `artifacts/api-server`) **avant** d’écouter le port HTTP, pour éviter les courses avec le login et aligner d’anciennes bases (colonnes manquantes).

### Copier une base Neon vers PostgreSQL local (preview / dev hors-ligne)

**Automatique (sans commandes manuelles)** — avec **Docker** démarré et un fichier **`.env`** à la racine contenant une URI Neon (`DATABASE_URL` dont l’hôte contient `neon.tech`, ou `NEON_DATABASE_URL`) :

```bash
pnpm run db:sync-neon-local
```

Le script `scripts/sync-neon-to-local.mjs` crée le réseau Docker `vouchernet-sync-net`, recrée le conteneur **`vouchernet-preview-pg`** (port hôte **5434**, utilisateur / mot de passe **`vouchernet`** / **`vouchernet`**, base **`vouchernet_preview`**), exécute `pg_dump` puis `pg_restore` via l’image `postgres:16-alpine`, puis **écrit automatiquement** `.env.local` à la racine avec la `DATABASE_URL` locale. L’API charge `.env` puis **`.env.local`** (priorité) au démarrage — **aucun copier-coller** n’est nécessaire.

Une seule commande pour **synchroniser Neon → local puis lancer API + Vite** (Docker + `.env` avec URI Neon requis) :

```bash
pnpm run dev:full
```

Pour une source non-Neon, définir **`NEON_SYNC_ALLOW_NON_NEON=1`** dans `.env` (à utiliser avec prudence).

---

**Manuel** — avec les outils clients PostgreSQL (**`pg_dump`** / **`pg_restore`**) installés sur la machine (ou via une image Docker `postgres` qui les contient) :

1. **Exporter** depuis Neon (URI avec `sslmode=require`, comme dans la console Neon) :

   ```bash
   pg_dump "postgresql://USER:PASSWORD@HOST/neondb?sslmode=require" -Fc -f neon-backup.dump
   ```

   `-Fc` = format personnalisé (recommandé pour `pg_restore`). Pour un fichier SQL texte : `-f backup.sql` sans `-Fc`.

2. **Créer** une base vide en local (ex. `vouchernet_preview`) avec votre Postgres local ou Docker.

3. **Importer** :

   ```bash
   pg_restore -h localhost -p 5432 -U VOTRE_USER_LOCAL -d vouchernet_preview --no-owner --no-acl neon-backup.dump
   ```

   En cas d’erreurs d’objets déjà présents sur une base réutilisée : recréer une base vide, ou utiliser `--clean` (destructif). Ajustez `-h`/`-p`/`-U` selon votre installation.

4. **Pointer l’API** vers la copie locale dans `.env` :

   `DATABASE_URL=postgresql://USER_LOCAL:PASS_LOCAL@localhost:5432/vouchernet_preview`

**Remarques :**

- **Données sensibles** : une copie locale contient les mêmes données que la prod / staging ; ne pas la commiter, ne pas la laisser sur un disque non chiffré si risque.
- **Branche Neon** (alternative sans gros dump sur disque) : dans la console Neon, créer une **branche** à partir de la base principale → une nouvelle URL `DATABASE_URL` pour un environnement de dev **toujours sur Neon** (copie légère côté cloud, pratique pour prévisualiser sans installer Postgres localement).

## Application mobile (`artifacts/mobile`)

- **WebView** : l’URL chargée par défaut est **`EXPO_PUBLIC_WEB_APP_URL`**, sinon `http://127.0.0.1:4173` (voir `app/index.tsx`). Sur un **téléphone physique**, utiliser l’IP LAN de votre PC (même Wi‑Fi), par ex. `http://192.168.1.10:4173`, via variable d’environnement.
- **Script `dev`** : `pnpm --filter @workspace/mobile run dev` lance Expo en **localhost** sans variables d’hébergeur externes.
- **Build statique** (`pnpm --filter @workspace/mobile run build`) : définir **`EXPO_PUBLIC_DOMAIN`** ou **`EXPO_PUBLIC_WEB_APP_URL`** (voir `artifacts/mobile/scripts/build.js`).
- **Stores (iOS / Android)** : `bundleIdentifier` et `package` Expo = **`com.nanotech.vouchers`** (`artifacts/mobile/app.json`). Si vous aviez déjà publié une app sous **`com.nanotech.vouchersbills`**, ce changement correspond à une **nouvelle fiche application** sur les stores (mise à jour « in-place » impossible entre deux identifiants différents).

Pour **expo-router** `origin` dans `app.json` : en local il pointe vers le front Vite par défaut ; pour une **release store**, mettre à jour `plugins` → `expo-router` → `origin` et `EXPO_PUBLIC_WEB_APP_URL` vers votre URL publique.

---

# VoucherNet — référence produit & architecture

Système de gestion de vouchers Wi-Fi hotspot compatible MikHmon 7.x / RouterOS MikroTik.

## Architecture

Monorepo pnpm avec les packages suivants :

### Artifacts
- `artifacts/app` — Frontend React + Vite (port défini par Vite, souvent **4173**, base path `/`)
- `artifacts/api-server` — Backend Express 5 (port **3001** par défaut, `PORT` pour surcharger)

### Librairies partagées
- `lib/db` — Schéma Drizzle ORM + connexion PostgreSQL
- `lib/api-spec` — Spécification OpenAPI YAML
- `lib/api-client-react` — Hooks React Query générés par Orval
- `lib/api-zod` — Schémas Zod générés (validation)

## Génération PDF
- `POST /api/print-pdf { html, title }` — Rendu Puppeteer → PDF A4 téléchargeable
- Environnement serveur avec Chromium système si disponible (paquets OS, ex. **Chromium** sous Linux) ; sinon fallback **`@sparticuz/chromium-min`**
- Browser singleton réutilisé entre requêtes, `page.emulateMediaType("print")` pour appliquer le CSS @media print
- Frontend : bouton "Enregistrer PDF" (vert) dans la barre d'actions du dernier lot, à côté de "Imprimer"
- `buildTicketHtmlForPdf(items, title, scale)` dans `print.ts` — layout mobile (table unique, sans autoprint)

## Tableau de bord — LAYOUT VERROUILLÉ MOBILE + DESKTOP (ne pas modifier)
### Mobile
- Ordre (CSS `order-N`) : Clients(0) Vendu(0) | Tickets(3) Vente(4) | Raccourcis(5) | Trafic(6) | Logs(7)
- StatCard `h-[4.75rem]` fixe, raccourcis même hauteur
- Icônes `self-center`, titre haut, montant centré, sous-titre bas
- Montant adaptatif `.amount-fill` + `--awv` CSS var `clamp(8px, Xvw, 20px)`
- Entiers alignés sur référence "20 100 FCFA" (`--awv: 4.83vw`)
### Desktop (lg)
- Grid 4 cols × 3 rows, Traffic `lg:h-[300px]`, Log `lg:h-[384px]` + `lg:overflow-hidden`
- Montant cap 22px via `@media (min-width: 1024px)` dans `.amount-fill`

## Fonctionnalités
- **Tableau de bord** — Stats globales (vouchers total/imprimés, routeurs)
- **Routeurs** — CRUD MikroTik RouterOS, test de connexion via API port 8728
- **Générer** — Création de vouchers hotspot depuis profils RouterOS (prix/durée parsés depuis le script on-login MikHmon)
- **Vouchers** — Liste avec filtres, impression, marquage imprimé, suppression
- **Vendeurs** — Scoped par routeur, portail vendeur séparé
- **Rapports** — Stats de ventes par vendeur et par période
- **Gérants de zone** — Sous-admins avec accès complet sauf création/suppression de ressources

## Système d'authentification — 5 rôles (multi-tenant)

### Rôles
| Rôle | Accès |
|------|-------|
| `super-admin` | Gère tous les admins (création, forfait, crédits, désactivation, suppression). Voit tous les routeurs. Login: `admin` / `root` |
| `admin` (régulier) | Accès complet à **son propre tenant** uniquement. Limite 5 routeurs (+5 par pack de 50 crédits). Bloqué si forfait expiré. |
| `manager` | Accès admin sauf : créer/supprimer routeurs/vendeurs/forfaits/templates. Verrouillable sur 1 routeur. |
| `collaborateur` | Accès admin **uniquement sur les routeurs assignés** (many-to-many). Badge violet. |
| `vendor` | Portail vendeur uniquement (vente de vouchers) |

### Multi-tenant — isolation des données
- `admin_settings.isSuperAdmin`, `forfaitMonths`, `forfaitEndsAt`, `credits`, `extraRouterSlots`, `isActive`
- `routers.ownerAdminId`, `managers.ownerAdminId`, `vendors.ownerAdminId`, `collaborateurs.ownerAdminId` — référence le tenant propriétaire
- Forfaits durables : 1, 2, 3, 4, 5, 6, 12 mois (extensibles)
- Pack routeurs : 50 crédits → +5 slots routeurs (super-admin a crédits illimités)
- Login bloqué (`403`) si `forfaitEndsAt < now`
- Création routeur bloquée (`402`) si limite atteinte
- Tenant scoping appliqué sur tous les CRUD : routers, managers, vendors, collaborateurs (PUT/DELETE refusent les ressources hors tenant)
- `/api/routers` et `/api/routers/:id*` exigent désormais un token valide (admin/manager/vendor/collab) ; les tokens non-admin sont scope sur les routeurs assignés (`403` sinon)

### Endpoints super-admin (`/api/super/admins`)
- `GET` — liste tous les admins
- `POST` — crée un nouvel admin (login, password, displayName, forfaitMonths, credits)
- `PATCH /:id` — met à jour (displayName, password, isActive, login)
- `POST /:id/credits` — alloue/retire des crédits
- `POST /:id/extend-forfait` — prolonge le forfait (+N mois)
- `DELETE /:id` — supprime (cascade tous routeurs/données du tenant). Auto-suppression interdite.

### Endpoints admin self (`/api/admin`)
- `GET /me` — retourne `{ id, login, isSuperAdmin, forfaitEndsAt, credits, extraRouterSlots, routerCount, routerLimit }`
- `POST /buy-routers` — achat pack 5 routeurs (50 crédits, `402` si insuffisant)
- `PUT /credentials` — l'admin connecté change son propre login et/ou mot de passe (champs indépendamment optionnels, login min 3, password min 4, collision exclut soi-même). UI : bouton « Mon compte » dans l'en-tête de `/super/admins`.

### Endpoint unifié
`POST /api/login { login, password }` — Essaie admin → manager → collaborateur → vendor dans l'ordre.  
Réponse collaborateur : `{ role: "collaborateur", token, collaborateur: { id, name, username, routerIds[] } }`

### Auth libs
- `artifacts/api-server/src/lib/admin-auth.ts` — token admin (stateless JWT-like)
- `artifacts/api-server/src/lib/manager-auth.ts` — token manager (JWT-like avec managerId)
- `artifacts/api-server/src/lib/collaborateur-auth.ts` — token collaborateur (JWT-like avec collaborateurId + routerIds[])
- `artifacts/api-server/src/lib/vendor-auth.ts` — token vendor (JWT-like avec vendorId)

### DB Schema Collaborateur
- `collaborateurs` table — id, name, username, passwordHash, passwordPlain, isActive
- `collaborateur_routers` table — junction many-to-many (collaborateurId, routerId)

### Pré-remplissage des mots de passe en clair (mai 2026)
- `passwordPlain` ajouté sur `vendors`, `managers`, `collaborateurs`, `admin_settings`
- Sauvegardé à chaque POST/PUT (création, mise à jour, changement de mot de passe /me/password)
- Retourné par l'API (safeVendor / safeManager / safeCollab strippent seulement passwordHash)
- Formulaires d'édition : login et mot de passe pré-remplis avec les valeurs actuelles
  - Vendors.tsx: `password: vendor.passwordPlain`
  - Managers.tsx: `password: manager.passwordPlain`
  - Collaborateurs.tsx: `password: collab.passwordPlain`
  - SuperAdmins.tsx AccountDialog: login + passwordPlain pré-remplis via `currentAdmin` prop

### Frontend
- `AuthContext.tsx` — stocke `{ token, role, vendorInfo, collaborateurRouterIds }` en localStorage
- `LoginPage.tsx` — page unifiée, redirige vers / (manager/collaborateur) ou /vendor-portal (vendor)
- `RouterContext.tsx` — filtre la liste des routeurs pour les collaborateurs (seuls les routeurs assignés sont visibles)
- `Collaborateurs.tsx` — page CRUD admin-only avec sélection multi-routeurs (checkboxes)
- `IpBindings.tsx` — page "Bypass MAC" : CRUD sur `/ip/hotspot/ip-binding` du routeur (bypass / blocked / regular). Utilise direct fetch via `${BASE}/api/routers/:id/ip-bindings`. Sidebar : groupe "Réseau", icône `ShieldCheck`.

## Configuration importante
- Le frontend (`/api/*`) est proxifié vers `http://localhost:3001` via Vite proxy
- Le mutator axios a `baseURL: '/api'`
- RouterOS API utilise `node-routeros` sur port 8728 (pas HTTP)
- Le format on-login MikHmon: `:put (",<expmode>,<price>,<validity>,<sprice>,,<lockMac>,")`
- localStorage keys: `vouchernet_admin_token`, `vouchernet_role`, `vouchernet_vendor_info`, `vouchernet_router_id`

## Base de données (PostgreSQL)
Tables: `routers`, `vouchers`, `vendors`, `admin_settings`, `managers`

### Table `managers`
```sql
id serial PK, name text, username text UNIQUE, password_hash text, is_active bool, created_at, updated_at
```

## Application mobile (Expo)
- `artifacts/mobile` — WebView Expo ; URL du front web : **`EXPO_PUBLIC_WEB_APP_URL`** ou défaut local `http://127.0.0.1:4173`
- Production: `build.js` démarre Metro, compile les bundles iOS/Android, crée `static-build/`
- Serve: `serve.js` (Node.js built-ins) sert les bundles + landing page sur `$PORT`
- Santé: `/status` et `/health` → `{ status: "ok" }`
- Versions compatibles Expo SDK 54: `react-native-webview@13.15.0`, `react-native-keyboard-controller@1.18.5`

## Workflows (pnpm à la racine du monorepo)
- Web : `pnpm --filter @workspace/app run dev`
- API : `pnpm --filter @workspace/api-server run dev`
- Expo : `pnpm --filter @workspace/mobile run dev`

## Optimisation des syncs MikroTik (avril 2026)
Les syncs depuis les routeurs étaient lents et timeout-aient. Causes corrigées :

1. **Plusieurs processus API sur le même port** — éviter de lancer deux fois `api-server` sur **3001** (deux processus = connexions concurrentes par routeur, sémaphores RouterOS saturés, `RosException errno -104`).

2. **Tempête de full-loads dans `script-cache.ts`** — chaque tick vendor-sync (20 s) appelait `syncScriptCache(routerId)` UNE FOIS PAR VENDOR. Avec plusieurs vendors par routeur, le `?comment=mikhmon` (heavy, 120 s timeout) était lancé N fois en parallèle pour la même donnée. Pire : si le full-load timeoutait, `lastFullLoadAt` n'était PAS mis à jour, donc le tick suivant retentait immédiatement → spirale.

   Fix appliqué dans `artifacts/api-server/src/lib/script-cache.ts` :
   - **In-flight dedup** (`Map<routerId, Promise>`) — les appels concurrents pour le même routeur partagent une seule promesse au lieu d'ouvrir N sessions MikroTik.
   - **Backoff exponentiel après échec** (`fullLoadFailStreak` + min 1 min, max 10 min) — un full-load échoué attend 1 min, puis 2, 4, 8, 10, 10… le streak est remis à zéro dès le premier succès (router redémarré récupère vite, router chroniquement injoignable n'est testé que toutes les 10 min).
   - **Throttle des incrémentaux par routeur** (`INCREMENTAL_MIN_GAP_MS = 60 s`) — N vendors sur le même routeur ne déclenchent qu'une seule série de requêtes par minute.
   - `clearRouterScriptCache` reset aussi `fullLoadFailStreak` (un sync forcé par l'utilisateur ne doit pas être bloqué par un backoff hérité).

   Résultat mesuré après restart : 5 routeurs → 5 full-loads (au lieu de 29 sur la même fenêtre avant), 1 échec transitoire (au lieu de 52), router 4 complète en ~26 s (au lieu de 120 s timeout). Les vendor backfills s'enchaînent normalement (4322 ventes historiques ré-attribuées sur router 2 vendor 9 dans la foulée).

## Plugins Vite `@replit/*`

Les paquets npm **`@replit/vite-plugin-*`** restent dans le dépôt (nom de scope historique). En dev **local**, les plugins optionnels (cartographer, bannière) ne se chargent que si la variable d’environnement **`REPL_ID`** est définie (voir `artifacts/app/vite.config.ts`). Sans cela, Vite tourne normalement en local Cursor.
