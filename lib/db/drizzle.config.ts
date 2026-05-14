import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
if (existsSync(path.join(repoRoot, ".env"))) config({ path: path.join(repoRoot, ".env") });
if (existsSync(path.join(repoRoot, ".env.local"))) config({ path: path.join(repoRoot, ".env.local"), override: true });

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
