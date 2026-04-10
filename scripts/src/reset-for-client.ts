/**
 * reset-for-client — Remet l'instance VoucherNet à l'état "usine".
 *
 * Ce script :
 *   1. Vide toutes les tables de données métier (dans l'ordre correct)
 *   2. Remet les credentials admin à admin/root
 *   3. Génère un fichier DEPLOY.md avec les instructions de première connexion
 *
 * Usage : pnpm reset-for-client
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── DB connection ────────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Erreur : la variable d'environnement DATABASE_URL est requise.");
  process.exit(1);
}

const db = drizzle(DATABASE_URL);

// ── Password hashing (same algo as API server) ────────────────────────────────

async function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");
    crypto.pbkdf2(password, salt, 100_000, 64, "sha512", (err, key) => {
      if (err) reject(err);
      else resolve(`${salt}:${key.toString("hex")}`);
    });
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function confirm(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    process.stdout.write(`\n${question} [oui/non] : `);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", (data) => {
      process.stdin.pause();
      const answer = String(data).trim().toLowerCase();
      resolve(answer === "oui" || answer === "o" || answer === "yes" || answer === "y");
    });
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║         VoucherNet — Réinitialisation pour client         ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log();
  console.log("Ce script va supprimer TOUTES les données métier :");
  console.log("  • Vouchers, Routeurs, Vendeurs, Gérants");
  console.log("  • Paiements (hebdomadaires & quotidiens)");
  console.log("  • Cache des profils et ventes de scripts");
  console.log("  • Credentials admin → réinitialisés à admin / root");
  console.log();
  console.warn("ATTENTION : Cette opération est irréversible !");
  console.log();

  const ok = await confirm("Voulez-vous vraiment continuer ?");
  if (!ok) {
    console.log("\nOpération annulée.");
    process.exit(0);
  }

  console.log("\n⏳ Réinitialisation en cours…\n");

  // Deletion order must respect FK constraints:
  // vendor_daily_payments → vendors / routers
  // vendor_payments       → vendors / routers
  // mikrotik_script_sales → routers
  // vouchers              → vendors / routers
  // profiles_cache        → routers
  // managers              → routers
  // vendors               → routers
  // routers               (no FK parent)
  // admin_settings        (standalone)

  const tables = [
    "vendor_daily_payments",
    "vendor_payments",
    "mikrotik_script_sales",
    "vouchers",
    "profiles_cache",
    "managers",
    "vendors",
    "routers",
    "admin_settings",
  ] as const;

  for (const table of tables) {
    await db.execute(sql.raw(`DELETE FROM "${table}"`));
    console.log(`  ✓ Table "${table}" vidée`);
  }

  // Reset admin credentials to admin / root
  const passwordHash = await hashPassword("root");
  await db.execute(
    sql.raw(
      `INSERT INTO admin_settings (login, password_hash) VALUES ('admin', '${passwordHash.replace(/'/g, "''")}')`
    )
  );
  console.log('  ✓ Credentials admin réinitialisés (admin / root)');

  // Generate DEPLOY.md
  const deployMd = generateDeployMd();
  const deployPath = path.resolve(__dirname, "../../DEPLOY.md");
  await fs.writeFile(deployPath, deployMd, "utf8");
  console.log(`\n📄 DEPLOY.md généré : ${deployPath}`);

  console.log("\n✅ Réinitialisation terminée. L'instance est prête à être livrée au client.");
  console.log("   Remettez le fichier DEPLOY.md au client avec ses informations de connexion.\n");
}

// ── DEPLOY.md generator ───────────────────────────────────────────────────────

function generateDeployMd(): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const timeStr = now.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return `# VoucherNet — Guide de démarrage

> Généré le ${dateStr} à ${timeStr}

## Bienvenue !

Votre instance **VoucherNet** est prête. Ce document contient tout ce dont vous avez besoin pour démarrer.

---

## Première connexion

| Champ            | Valeur     |
|------------------|------------|
| **Identifiant**  | \`admin\`  |
| **Mot de passe** | \`root\`   |

> **Important** : Changez le mot de passe dès votre première connexion. Un assistant de configuration vous guidera automatiquement au premier démarrage.

---

## Étapes de configuration initiale

L'application affichera un **assistant de configuration** au premier démarrage. Suivez ces étapes :

### Étape 1 — Changer le mot de passe administrateur
- Choisissez un mot de passe fort (8 caractères minimum recommandés)
- Ce mot de passe remplace le mot de passe par défaut \`root\`

### Étape 2 — Ajouter votre premier routeur MikroTik
- **Nom** : un nom identifiable pour ce routeur (ex. : "Routeur Principal")
- **Hôte (IP)** : l'adresse IP locale du routeur MikroTik
- **Port** : 8728 (par défaut pour l'API MikroTik)
- **Identifiant / Mot de passe** : les credentials de l'API MikroTik

---

## Accès à l'application

L'URL de votre application vous a été communiquée par votre prestataire.

---

## Support

Pour toute question ou problème, contactez votre prestataire technique.
`;
}

// ── Run ───────────────────────────────────────────────────────────────────────

main().catch((err: unknown) => {
  console.error("\n❌ Erreur lors de la réinitialisation :", err);
  process.exit(1);
});
