"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
for (const f of ["package-lock.json", "yarn.lock"]) {
  const p = path.join(root, f);
  try {
    fs.unlinkSync(p);
  } catch (e) {
    if (e && e.code !== "ENOENT") throw e;
  }
}

const ua = process.env.npm_config_user_agent ?? "";
if (/pnpm\//i.test(ua)) process.exit(0);
if (process.env.CI === "true") {
  console.error(
    "Non-pnpm install detected in CI; continuing for deployment compatibility.",
  );
  process.exit(0);
}
console.error("Use pnpm instead");
process.exit(1);
