# VoucherNet

Système de gestion de vouchers Wi-Fi hotspot compatible MikHmon 7.x / RouterOS MikroTik.

## Architecture

Monorepo pnpm avec les packages suivants :

### Artifacts
- `artifacts/app` — Frontend React + Vite (port $PORT, base path `/`)
- `artifacts/api-server` — Backend Express 5 (port 3001)

### Librairies partagées
- `lib/db` — Schéma Drizzle ORM + connexion PostgreSQL
- `lib/api-spec` — Spécification OpenAPI YAML
- `lib/api-client-react` — Hooks React Query générés par Orval
- `lib/api-zod` — Schémas Zod générés (validation)

## Génération PDF
- `POST /api/print-pdf { html, title }` — Rendu Puppeteer (Chromium NixOS) → PDF A4 téléchargeable
- Chromium installé via `pkgs.chromium` (NixOS, v138) ; fallback `@sparticuz/chromium-min` si absent
- Browser singleton réutilisé entre requêtes, `page.emulateMediaType("print")` pour appliquer le CSS @media print
- Frontend : bouton "Enregistrer PDF" (vert) dans la barre d'actions du dernier lot, à côté de "Imprimer"
- `buildTicketHtmlForPdf(items, title, scale)` dans `print.ts` — layout mobile (table unique, sans autoprint)

## Tableau de bord — LAYOUT VERROUILLÉ (ne pas modifier)
- StatCard : icône centrée (`self-center`), titre en haut, montant centré (`flex-1 flex items-center`), sous-titre en bas
- Montant adaptatif : classe `.amount-fill` + `--awv` CSS var (`clamp(8px, Xvw, 20px)` mobile / 22px desktop)
- Ordre mobile (CSS `order-N`) : Clients(0) Vendu(0) | Tickets(3) Vente(4) | Raccourcis(5) | Trafic(6) | Logs(7)
- Desktop (lg) : grid 4 cols × 3 rows fixés, Traffic `lg:h-[300px]`, Log `lg:h-[384px]` + `lg:overflow-hidden`

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
- `collaborateurs` table — id, name, username, passwordHash, isActive
- `collaborateur_routers` table — junction many-to-many (collaborateurId, routerId)

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
- `artifacts/mobile` — WebView Expo wrappant `https://nanotech-voucher.replit.app`
- Production: `build.js` démarre Metro, compile les bundles iOS/Android, crée `static-build/`
- Serve: `serve.js` (Node.js built-ins) sert les bundles + landing page sur `$PORT`
- Santé: `/status` et `/health` → `{ status: "ok" }`
- Versions compatibles Expo SDK 54: `react-native-webview@13.15.0`, `react-native-keyboard-controller@1.18.5`

## Workflows
- `artifacts/app: web` — `pnpm --filter @workspace/app run dev`
- `artifacts/api-server: api` — `pnpm --filter @workspace/api-server run dev`
- `artifacts/mobile: expo` — `pnpm --filter @workspace/mobile run dev`

## Optimisation des syncs MikroTik (avril 2026)
Les syncs depuis les routeurs étaient lents et timeout-aient. Causes corrigées :

1. **Workflow API-server dupliqué** — un orphan `artifacts/api-server: API Server` tournait en parallèle du workflow géré par l'artefact (`api`), tous les deux sur le port 3001. Deux processus = deux connexions concurrentes par routeur, saturant les sémaphores RouterOS et provoquant des `RosException errno -104`. Workflow orphelin supprimé via `removeWorkflow`.

2. **Tempête de full-loads dans `script-cache.ts`** — chaque tick vendor-sync (20 s) appelait `syncScriptCache(routerId)` UNE FOIS PAR VENDOR. Avec plusieurs vendors par routeur, le `?comment=mikhmon` (heavy, 120 s timeout) était lancé N fois en parallèle pour la même donnée. Pire : si le full-load timeoutait, `lastFullLoadAt` n'était PAS mis à jour, donc le tick suivant retentait immédiatement → spirale.

   Fix appliqué dans `artifacts/api-server/src/lib/script-cache.ts` :
   - **In-flight dedup** (`Map<routerId, Promise>`) — les appels concurrents pour le même routeur partagent une seule promesse au lieu d'ouvrir N sessions MikroTik.
   - **Backoff exponentiel après échec** (`fullLoadFailStreak` + min 1 min, max 10 min) — un full-load échoué attend 1 min, puis 2, 4, 8, 10, 10… le streak est remis à zéro dès le premier succès (router redémarré récupère vite, router chroniquement injoignable n'est testé que toutes les 10 min).
   - **Throttle des incrémentaux par routeur** (`INCREMENTAL_MIN_GAP_MS = 60 s`) — N vendors sur le même routeur ne déclenchent qu'une seule série de requêtes par minute.
   - `clearRouterScriptCache` reset aussi `fullLoadFailStreak` (un sync forcé par l'utilisateur ne doit pas être bloqué par un backoff hérité).

   Résultat mesuré après restart : 5 routeurs → 5 full-loads (au lieu de 29 sur la même fenêtre avant), 1 échec transitoire (au lieu de 52), router 4 complète en ~26 s (au lieu de 120 s timeout). Les vendor backfills s'enchaînent normalement (4322 ventes historiques ré-attribuées sur router 2 vendor 9 dans la foulée).
