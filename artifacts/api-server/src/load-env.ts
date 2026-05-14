import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const rootEnv = path.join(repoRoot, ".env");
const rootEnvLocal = path.join(repoRoot, ".env.local");
const pkgEnv = path.resolve(here, "../.env");

if (existsSync(rootEnv)) config({ path: rootEnv });
if (existsSync(pkgEnv)) config({ path: pkgEnv, override: true });
if (existsSync(rootEnvLocal)) config({ path: rootEnvLocal, override: true });
