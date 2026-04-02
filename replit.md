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

## Système d'authentification — 3 rôles

### Rôles
| Rôle | Accès |
|------|-------|
| `admin` | Accès complet. Login: `admin` / `root` par défaut |
| `manager` | Accès complet sauf : créer/supprimer routeurs, vendeurs, forfaits, templates |
| `vendor` | Portail vendeur uniquement (vente de vouchers) |

### Endpoint unifié
`POST /api/login { login, password }` — Essaie admin → manager → vendor dans l'ordre.

### Auth libs
- `artifacts/api-server/src/lib/admin-auth.ts` — token admin (stateless JWT-like)
- `artifacts/api-server/src/lib/manager-auth.ts` — token manager (JWT-like avec managerId)
- `artifacts/api-server/src/lib/vendor-auth.ts` — token vendor (JWT-like avec vendorId)

### Frontend
- `AuthContext.tsx` — stocke `{ token, role, vendorInfo }` en localStorage
- `LoginPage.tsx` — page unifiée, redirige vers /routers (admin/manager) ou /vendor-portal (vendor)
- `RouterContext.tsx` — pas d'auto-sélection de routeur au démarrage

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

## Workflows
- `artifacts/app: web` — `pnpm --filter @workspace/app run dev`
- `artifacts/api-server: api` — `pnpm --filter @workspace/api-server run dev`
