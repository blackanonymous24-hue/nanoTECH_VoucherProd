import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type DefaultPresetBodies = {
  mikhmon: string;
  nanotechNormal: string;
  nanotechSmall: string;
};

let cache: DefaultPresetBodies | null = null;

/** Corps PHP/HTML des 3 presets livrés dans `default-presets/*.php` (modèles nanoTECH / Mikhmon). */
export function getDefaultPresetBodies(): DefaultPresetBodies {
  if (cache) return cache;
  const dir = dirname(fileURLToPath(import.meta.url));
  const presetDir = join(dir, "default-presets");
  cache = {
    mikhmon: readFileSync(join(presetDir, "mikhmon.php"), "utf8").replace(/^\uFEFF/, "").trim(),
    nanotechNormal: readFileSync(join(presetDir, "nanotech-normal.php"), "utf8").replace(/^\uFEFF/, "").trim(),
    nanotechSmall: readFileSync(join(presetDir, "nanotech-small.php"), "utf8").replace(/^\uFEFF/, "").trim(),
  };
  return cache;
}
