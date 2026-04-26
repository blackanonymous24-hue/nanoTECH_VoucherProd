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

## Fonctionnalités
- **Tableau de bord** — Stats globales (vouchers total/imprimés, routeurs)
- **Routeurs** — CRUD MikroTik RouterOS, test de connexion via API port 8728
- **Générer** — Création de vouchers hotspot depuis profils RouterOS (prix/durée parsés depuis le script on-login MikHmon)
- **Vouchers** — Liste avec filtres, impression, marquage imprimé, suppression
- **Vendeurs** — Scoped par routeur, portail vendeur séparé
- **Rapports** — Stats de ventes par vendeur et par période
- **Gérants de zone** — Sous-admins avec accès complet sauf création/suppression de ressources

## Système d'authentification — 4 rôles

### Rôles
| Rôle | Accès |
|------|-------|
| `admin` | Accès complet. Login: `admin` / `root` par défaut |
| `manager` | Accès complet sauf : créer/supprimer routeurs, vendeurs, forfaits, templates. Peut être verrouillé sur 1 routeur. |
| `collaborateur` | Accès admin complet mais **uniquement sur les routeurs qui lui sont assignés** (many-to-many). Badge violet. |
| `vendor` | Portail vendeur uniquement (vente de vouchers) |

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
