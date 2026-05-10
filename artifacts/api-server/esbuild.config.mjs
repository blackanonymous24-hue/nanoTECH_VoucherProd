import * as esbuild from "esbuild";
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outdir: "dist",
  // Only native binaries and truly optional dev-only packages are external.
  // Everything else (pg, drizzle-orm, node-routeros, etc.) is bundled so
  // the production Autoscale container can run without node_modules.
  external: [
    "pg-native",        // native addon — cannot bundle
    "source-map-support",
  ],
  banner: {
    js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
  },
});

const presetSrc = join(__dirname, "src/lib/default-presets");
const presetDst = join(__dirname, "dist/default-presets");
mkdirSync(presetDst, { recursive: true });
cpSync(presetSrc, presetDst, { recursive: true });
