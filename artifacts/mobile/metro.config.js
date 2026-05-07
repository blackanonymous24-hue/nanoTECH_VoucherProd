const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

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

module.exports = config;
