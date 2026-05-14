/**
 * Copie automatique Neon → PostgreSQL local (Docker).
 * Prérequis : Docker installé et démarré.
 *
 * Source : fichiers racine `.env` puis `.env.local` — `NEON_DATABASE_URL` en priorité,
 *          sinon la première `DATABASE_URL` qui contient `neon.tech` (ignore une
 *          `DATABASE_URL` locale déjà présente dans `.env.local`).
 *          Autre source : `NEON_SYNC_ALLOW_NON_NEON=1` dans l’environnement du shell.
 * Cible : conteneur `vouchernet-preview-pg`, port hôte **5434**, base `vouchernet_preview`,
 *          redémarrage automatique avec Docker (`--restart unless-stopped`).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const NETWORK = "vouchernet-sync-net";
const CONTAINER = "vouchernet-preview-pg";
const LOCAL_PORT = "5434";
const LOCAL_USER = "vouchernet";
const LOCAL_PASS = "vouchernet";
const LOCAL_DB = "vouchernet_preview";

function parseEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

/** URL Neon (ou autre si allowAny) à partir de `.env` / `.env.local`, sans confondre avec une DATABASE_URL locale. */
function resolveSourceUrl() {
  const envPath = path.join(repoRoot, ".env");
  const localPath = path.join(repoRoot, ".env.local");
  const fromEnv = parseEnvFile(envPath);
  const fromLocal = parseEnvFile(localPath);

  let source = (fromEnv.NEON_DATABASE_URL || fromLocal.NEON_DATABASE_URL || "").trim();
  if (!source) {
    const dEnv = (fromEnv.DATABASE_URL || "").trim();
    if (dEnv.includes("neon.tech")) source = dEnv;
  }
  if (!source) {
    const dLocal = (fromLocal.DATABASE_URL || "").trim();
    if (dLocal.includes("neon.tech")) source = dLocal;
  }
  return { source, fromEnv, fromLocal };
}

function docker(args, { inherit = false } = {}) {
  const r = spawnSync("docker", args, {
    encoding: "utf8",
    stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  return r;
}

function fail(msg, err) {
  console.error(msg);
  if (err?.stdout) console.error(err.stdout);
  if (err?.stderr) console.error(err.stderr);
  process.exit(1);
}

function main() {
  const allowAny = process.env.NEON_SYNC_ALLOW_NON_NEON === "1";
  const { source: resolved, fromEnv, fromLocal } = resolveSourceUrl();
  let source = resolved;

  if (!source && allowAny) {
    source =
      (fromEnv.NEON_DATABASE_URL || fromLocal.NEON_DATABASE_URL || "").trim() ||
      (fromEnv.DATABASE_URL || fromLocal.DATABASE_URL || "").trim();
  }

  if (!source) {
    fail(
      "Aucune URL source Neon : dans `.env` ou `.env.local`, définissez NEON_DATABASE_URL=… ou DATABASE_URL=… (hôte neon.tech). Une DATABASE_URL locale seule ne suffit pas pour le dump.",
    );
  }

  if (!allowAny && !source.includes("neon.tech")) {
    fail(
      "L’URL source ne pointe pas vers neon.tech. Pour une autre base, exportez NEON_SYNC_ALLOW_NON_NEON=1 ou utilisez NEON_DATABASE_URL.",
    );
  }

  const dv = docker(["version"]);
  if (dv.status !== 0) {
    fail("Docker n’est pas disponible (docker version a échoué). Démarrez Docker Desktop puis réessayez.", dv);
  }

  console.log("→ Réseau Docker…");
  const netInspect = docker(["network", "inspect", NETWORK]);
  if (netInspect.status !== 0) {
    const nc = docker(["network", "create", NETWORK]);
    if (nc.status !== 0) fail("Impossible de créer le réseau Docker.", nc);
  }

  console.log("→ Recréation du Postgres local de preview…");
  docker(["rm", "-f", CONTAINER]);
  const run = docker([
    "run",
    "-d",
    "--restart",
    "unless-stopped",
    "--name",
    CONTAINER,
    "--network",
    NETWORK,
    "-e",
    `POSTGRES_USER=${LOCAL_USER}`,
    "-e",
    `POSTGRES_PASSWORD=${LOCAL_PASS}`,
    "-e",
    `POSTGRES_DB=${LOCAL_DB}`,
    "-p",
    `${LOCAL_PORT}:5432`,
    "postgres:16-alpine",
  ]);
  if (run.status !== 0) fail("Impossible de démarrer le conteneur Postgres local.", run);

  console.log("→ Attente Postgres local…");
  for (let i = 0; i < 60; i++) {
    const ready = docker([
      "exec",
      CONTAINER,
      "pg_isready",
      "-U",
      LOCAL_USER,
      "-d",
      LOCAL_DB,
    ]);
    if (ready.status === 0) break;
    spawnSync(process.platform === "win32" ? "timeout" : "sleep", process.platform === "win32" ? ["/t", "1", "/nobreak"] : ["1"], {
      stdio: "ignore",
    });
    if (i === 59) fail("Timeout : Postgres local ne répond pas.", ready);
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "neon-sync-"));
  const b64 = Buffer.from(source.trim(), "utf8").toString("base64");

  const mount = path.resolve(workDir).replace(/\\/g, "/");

  console.log("→ pg_dump (Neon) → pg_restore (local)…");
  const innerSh = `set -eu
NEON_URI=$(printf '%s' "$URI_B64" | base64 -d)
rm -f /work/dump.fc
pg_dump "$NEON_URI" -Fc -f /work/dump.fc
test -s /work/dump.fc
pg_restore -h ${CONTAINER} -p 5432 -U ${LOCAL_USER} -d ${LOCAL_DB} --no-owner --no-acl /work/dump.fc
`;
  const sync = docker(
    [
      "run",
      "--rm",
      "--network",
      NETWORK,
      "-v",
      `${mount}:/work`,
      "-e",
      `URI_B64=${b64}`,
      "-e",
      `PGPASSWORD=${LOCAL_PASS}`,
      "postgres:16-alpine",
      "sh",
      "-c",
      innerSh,
    ],
    { inherit: true },
  );

  const dumpPath = path.join(workDir, "dump.fc");
  let dumpBytes = 0;
  try {
    if (fs.existsSync(dumpPath)) dumpBytes = fs.statSync(dumpPath).size;
  } catch {
    /* ignore */
  }

  try {
    fs.rmSync(workDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  const restoreWarningsOnly = sync.status === 1;
  const syncOk = sync.status === 0 || restoreWarningsOnly;
  if (!syncOk) {
    fail("pg_dump / pg_restore a échoué (code de sortie Docker / sh). Vérifiez l’URL Neon, que le compute est actif, et les logs ci-dessus.", sync);
  }
  if (dumpBytes < 1) {
    fail(
      "Le fichier de dump est absent ou vide : la connexion Neon a probablement échoué (endpoint désactivé, identifiants invalides, etc.). Corrigez la source puis relancez.",
    );
  }

  const localUrl = `postgresql://${LOCAL_USER}:${encodeURIComponent(LOCAL_PASS)}@127.0.0.1:${LOCAL_PORT}/${LOCAL_DB}?sslmode=disable`;
  const envLocalPath = path.join(repoRoot, ".env.local");
  const neonForResync =
    (fromLocal.NEON_DATABASE_URL || fromEnv.NEON_DATABASE_URL || "").trim() || "";
  let envLocalBody =
    "# Généré / mis à jour par pnpm run db:sync-neon-local — DATABASE_URL = Postgres Docker local.\n" +
    "# Optionnel : NEON_DATABASE_URL ci-dessous pour les prochaines syncs sans remettre Neon dans .env.\n";
  if (neonForResync) {
    envLocalBody += `NEON_DATABASE_URL=${neonForResync}\n`;
  }
  envLocalBody += `DATABASE_URL=${localUrl}\n`;
  fs.writeFileSync(envLocalPath, envLocalBody, { mode: 0o600 });
  console.log("");
  console.log("Copie terminée.");
  console.log(`→ ${path.relative(repoRoot, envLocalPath)} écrit : l’API chargera cette DATABASE_URL au prochain démarrage (priorité sur .env).`);
  console.log("");
}

main();
