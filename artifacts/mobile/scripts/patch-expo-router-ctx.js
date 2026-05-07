/**
 * Patches expo-router's _ctx*.js files to replace dynamic process.env references
 * with static string literals.
 *
 * WHY: Metro's collect-dependencies step validates require.context() calls and
 * requires the first argument to be a StringLiteral in the AST. expo-router ships
 * _ctx*.js files that use process.env.EXPO_ROUTER_APP_ROOT as the first argument.
 * babel-preset-expo does NOT inline this variable, so collect-dependencies always
 * sees a MemberExpression and throws "Invalid call".
 *
 * FIX: After pnpm install, replace the env var references with hardcoded strings
 * using __dirname (absolute, reliable in all environments including EAS Build).
 */

const fs = require("fs");
const path = require("path");

const mobileRoot = path.resolve(__dirname, "..");
const appRoot =
  process.env.EXPO_ROUTER_APP_ROOT || path.join(mobileRoot, "app");
const importMode = process.env.EXPO_ROUTER_IMPORT_MODE || "sync";

const ctxFiles = [
  "_ctx.android.js",
  "_ctx.ios.js",
  "_ctx.js",
  "_ctx.web.js",
  "_ctx-shared.js",
  "_ctx-html.js",
];

let patched = 0;
for (const file of ctxFiles) {
  const filePath = path.join(mobileRoot, "node_modules", "expo-router", file);
  try {
    let content = fs.readFileSync(filePath, "utf8");
    const original = content;
    content = content.replace(
      /process\.env\.EXPO_ROUTER_APP_ROOT/g,
      JSON.stringify(appRoot)
    );
    content = content.replace(
      /process\.env\.EXPO_ROUTER_IMPORT_MODE/g,
      JSON.stringify(importMode)
    );
    if (content !== original) {
      fs.writeFileSync(filePath, content);
      console.log(`[patch-expo-router-ctx] Patched: ${file}`);
      patched++;
    } else {
      console.log(`[patch-expo-router-ctx] Already patched: ${file}`);
    }
  } catch {
    // file doesn't exist for this expo-router version, skip silently
  }
}

console.log(`[patch-expo-router-ctx] Done — ${patched} file(s) patched.`);
console.log(`[patch-expo-router-ctx]   appRoot: ${appRoot}`);
console.log(`[patch-expo-router-ctx]   importMode: ${importMode}`);
