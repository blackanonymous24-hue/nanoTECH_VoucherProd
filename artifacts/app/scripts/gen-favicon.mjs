import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(__dirname, "..", "public");
const b64 = fs.readFileSync(path.join(pub, "nanotech-logo.png")).toString("base64");

/** Cadre noir arrondi à 80 %, logo zoomé ×1,28 (style menu/login). */
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="180" height="180" viewBox="0 0 180 180">
  <defs>
    <clipPath id="frameClip">
      <rect x="16" y="16" width="148" height="148" rx="32"/>
    </clipPath>
  </defs>
  <rect x="16" y="16" width="148" height="148" rx="32" fill="#000000" opacity="0.8" stroke="#1e293b" stroke-opacity="0.8" stroke-width="2"/>
  <g clip-path="url(#frameClip)">
    <g transform="translate(90 90) scale(1.28) translate(-90 -90)">
      <image xlink:href="data:image/png;base64,${b64}" x="18" y="50" width="144" height="80" preserveAspectRatio="xMidYMid meet"/>
    </g>
  </g>
</svg>`;

const out = path.join(pub, "favicon.svg");
fs.writeFileSync(out, svg);
console.log("Wrote", out, "(" + fs.statSync(out).size + " bytes)");
