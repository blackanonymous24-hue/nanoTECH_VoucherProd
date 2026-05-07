const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

// Require expo explicitly from the mobile package's own node_modules.
// In deployment the CWD may differ from __dirname, so we use an absolute
// path to avoid "cannot find expo/package.json" resolution failures.
const { getDefaultConfig } = require(
  path.join(projectRoot, "node_modules/expo/metro-config")
);

const config = getDefaultConfig(projectRoot);

// Watch all files in the monorepo so Metro can find shared packages.
// Merge with Expo's default watchFolders instead of replacing them.
config.watchFolders = [
  ...(config.watchFolders || []),
  monorepoRoot,
];

// Let Metro resolve packages from both the app node_modules and the
// monorepo root node_modules (pnpm hoist strategy).
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

// Force singleton packages to always resolve to the local (mobile) copy
// to avoid duplicate module issues in pnpm workspaces.
config.resolver.extraNodeModules = {
  react: path.resolve(projectRoot, "node_modules/react"),
  "react-dom": path.resolve(projectRoot, "node_modules/react-dom"),
  "react-native": path.resolve(projectRoot, "node_modules/react-native"),
};

// expo-router/_ctx.android.js calls require.context(process.env.EXPO_ROUTER_APP_ROOT).
// Metro transform workers run in separate child processes and do NOT inherit env vars
// set at runtime in metro.config.js. Using transformer.define injects a literal string
// directly into the transform pipeline, reaching every worker process.
// This is the only reliable fix for EAS Build monorepo setups.
const appRoot = process.env.EXPO_ROUTER_APP_ROOT || path.join(projectRoot, "app");
config.transformer = {
  ...(config.transformer || {}),
  define: {
    ...((config.transformer || {}).define || {}),
    "process.env.EXPO_ROUTER_APP_ROOT": JSON.stringify(appRoot),
  },
};

module.exports = config;
