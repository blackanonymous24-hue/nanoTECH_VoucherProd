import * as esbuild from "esbuild";
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

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

// Voucher print templates : lus à l'exécution depuis `ticket-templates/` (voir voucher-print-page.ts).
// Sans cette copie, `node dist/index.js` ne trouverait pas les fichiers (.php.txt non importables par tsx).
mkdirSync(join(root, "dist"), { recursive: true });
cpSync(join(root, "src/lib/ticket-templates"), join(root, "dist/ticket-templates"), { recursive: true });
