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

## Configuration importante
- Le frontend (`/api/*`) est proxifié vers `http://localhost:3001` via Vite proxy
- Le mutator axios a `baseURL: '/api'`
- La table `vouchers` a le schéma VoucherNet (id, router_id, username, password, profile_name, price, validity, comment, printed_at, created_at)
- RouterOS API utilise `node-routeros` sur port 8728 (pas HTTP)
- Le format on-login MikHmon: `:put (",<expmode>,<price>,<validity>,<sprice>,,<lockMac>,")`

## Base de données (PostgreSQL)
Tables: `routers`, `vouchers`

## Workflows
- `artifacts/app: web` — `pnpm --filter @workspace/app run dev`
- `artifacts/api-server: API Server` — `pnpm --filter @workspace/api-server run dev`
