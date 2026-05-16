import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT;
const port = rawPort && !Number.isNaN(Number(rawPort)) ? Number(rawPort) : 4173;

const basePath = process.env.BASE_PATH ?? "/";
/** Sans slash final — pour proxy dev quand l’app est servie sous un sous-chemin (`BASE_PATH=/foo/`). */
const basePathNoTrailing = basePath.replace(/\/$/, "");

function buildApiProxy(): Record<string, { target: string; changeOrigin: boolean; rewrite?: (path: string) => string }> {
  const target = "http://localhost:3001";
  const common = { target, changeOrigin: true as const };
  const out: Record<string, { target: string; changeOrigin: boolean; rewrite?: (path: string) => string }> = {
    "/api": common,
  };
  if (basePathNoTrailing && basePathNoTrailing !== "") {
    const escaped = basePathNoTrailing.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const prefix = `${basePathNoTrailing}/api`;
    out[prefix] = {
      ...common,
      rewrite: (p) => p.replace(new RegExp(`^${escaped}/api`), "/api"),
    };
  }
  return out;
}

/** Plugin : headers de cache corrects pour dev + preview (production).
 *  - index.html / racine → no-store (toujours rechargé après déploiement)
 *  - /assets/* (JS/CSS hashés) → immutable 1 an (contenu ne change jamais)
 */
const cacheHeaders = (): import("vite").Plugin => {
  const applyHeaders = (server: import("vite").PreviewServer | import("vite").ViteDevServer) => {
    server.middlewares.use((_req, res, next) => {
      const url = (_req as { url?: string }).url ?? "";
      if (url === "/" || url.endsWith(".html") || url === "") {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
      } else if (url.includes("/assets/")) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
      next();
    });
  };
  return {
    name: "cache-headers",
    configureServer: applyHeaders,
    configurePreviewServer: applyHeaders,
  };
};

export default defineConfig({
  base: basePath,
  plugins: [
    cacheHeaders(),
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    // Optional Vite tooling plugins (npm scope `@replit/*`); only when REPL_ID is set.
    ...(process.env.NODE_ENV !== "production" && process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom"],
          "vendor-query": ["@tanstack/react-query"],
          "vendor-ui": [
            "@radix-ui/react-dialog",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-select",
            "@radix-ui/react-tooltip",
            "@radix-ui/react-popover",
          ],
        },
      },
    },
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: buildApiProxy(),
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: buildApiProxy(),
  },
});
