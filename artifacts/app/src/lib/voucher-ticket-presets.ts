import bodyMikhmonSmall from "./ticket-templates/mikhmon-small.php.txt?raw";
import bodyNanotechNormal from "./ticket-templates/nanotech-normal.php.txt?raw";
import bodyNanotechSmall from "./ticket-templates/nanotech-small.php.txt?raw";

/** Identifiants des 3 seuls modèles embarqués (fichiers `ticket-templates/*.php.txt`). */
export type TicketTemplatePresetId = "mikhmon-small" | "nanotech-normal" | "nanotech-small";

/** Modèle choisi en UI / en base (intégré ou personnalisé). */
export type TicketTemplateSelectionId = TicketTemplatePresetId | "custom";

export const DEFAULT_TICKET_PRESET_ID: TicketTemplatePresetId = "mikhmon-small";

/** Dernier modèle prédéfini choisi (utilisé quand le serveur n’a pas encore de modèle). */
export const TICKET_PRESET_STORAGE_KEY = "vouchernet_ticket_template_preset_v1";

const BODIES: Record<TicketTemplatePresetId, string> = {
  "mikhmon-small": bodyMikhmonSmall,
  "nanotech-normal": bodyNanotechNormal,
  "nanotech-small": bodyNanotechSmall,
};

export const TICKET_TEMPLATE_PRESETS: { id: TicketTemplatePresetId; label: string }[] = [
  { id: "mikhmon-small", label: "Mikhmon (small)" },
  { id: "nanotech-normal", label: "nanoTECH (normal)" },
  { id: "nanotech-small", label: "nanoTECH (small)" },
];

export function getPresetBody(id: TicketTemplatePresetId): string {
  return BODIES[id];
}

export function getStoredTicketPresetId(): TicketTemplateSelectionId {
  try {
    const v = localStorage.getItem(TICKET_PRESET_STORAGE_KEY);
    if (v === "mikhmon-small" || v === "nanotech-normal" || v === "nanotech-small") return v;
    if (v === "custom") return "custom";
  } catch {
    /* ignore */
  }
  return DEFAULT_TICKET_PRESET_ID;
}

export function setStoredTicketPresetId(id: TicketTemplateSelectionId): void {
  try {
    localStorage.setItem(TICKET_PRESET_STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

/**
 * Normalise le texte avant comparaison (éditeur CodeMirror : fins de ligne, newline finale).
 * On conserve les espaces / tabulations en tête et en fin de ligne du gabarit d’origine.
 */
export function normalizeTicketTemplateForCompare(source: string): string {
  return source
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n+$/g, "");
}

/**
 * Empreinte pour comparer au gabarit embarqué : écarts fréquents entre fichier
 * bundle, API / MySQL et éditeur (indentation avant `<?php` ou `<table`, fin de fichier).
 */
function fingerprintForPresetMatch(source: string): string {
  return normalizeTicketTemplateForCompare(source)
    .replace(/^[ \t\r\f\v]+/, "")
    .trimEnd();
}

/** Valeurs `preset_id` acceptées côté API / base. */
const SERVER_PRESET_IDS = new Set<string>([
  "mikhmon-small",
  "nanotech-normal",
  "nanotech-small",
  "custom",
]);

/** Interprète la colonne serveur `ticket_template_preset`. */
export function parseServerTicketTemplatePresetId(raw: unknown): TicketTemplateSelectionId | null {
  if (typeof raw !== "string" || !SERVER_PRESET_IDS.has(raw)) return null;
  return raw as TicketTemplateSelectionId;
}

/**
 * Choix de modèle affiché : la valeur en base l’emporte ; sinon déduction depuis le contenu ;
 * si contenu vide, repli sur le dernier choix local (legacy).
 */
export function resolveTicketTemplateSelection(args: {
  templateBody: string;
  serverPresetId: unknown;
}): TicketTemplateSelectionId {
  const fromDb = parseServerTicketTemplatePresetId(args.serverPresetId);
  if (fromDb != null) return fromDb;

  const trimmed = args.templateBody.trim();
  if (!trimmed) return getStoredTicketPresetId();
  return findMatchingPresetId(args.templateBody);
}

/** Repère si le contenu correspond à un des trois modèles fournis (comparaison assouplie). */
export function findMatchingPresetId(code: string): TicketTemplatePresetId | "custom" {
  const t = fingerprintForPresetMatch(code);
  for (const id of Object.keys(BODIES) as TicketTemplatePresetId[]) {
    if (fingerprintForPresetMatch(BODIES[id]) === t) return id;
  }
  return "custom";
}
