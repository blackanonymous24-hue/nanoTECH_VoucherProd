import bodyMikhmonSmall from "./ticket-templates/mikhmon-small.php.txt?raw";
import bodyNanotechNormal from "./ticket-templates/nanotech-normal.php.txt?raw";
import bodyNanotechSmall from "./ticket-templates/nanotech-small.php.txt?raw";

/** Identifiants des 3 seuls modèles embarqués (fichiers `ticket-templates/*.php.txt`). */
export type TicketTemplatePresetId = "mikhmon-small" | "nanotech-normal" | "nanotech-small";

export const DEFAULT_TICKET_PRESET_ID: TicketTemplatePresetId = "mikhmon-small";

/** Dernier modèle prédéfini choisi (utilisé quand le serveur n’a pas encore de modèle). */
export const TICKET_PRESET_STORAGE_KEY = "vouchernet_ticket_template_preset_v1";

const BODIES: Record<TicketTemplatePresetId, string> = {
  "mikhmon-small": bodyMikhmonSmall,
  "nanotech-normal": bodyNanotechNormal,
  "nanotech-small": bodyNanotechSmall,
};

export const TICKET_TEMPLATE_PRESETS: { id: TicketTemplatePresetId; label: string }[] = [
  { id: "mikhmon-small", label: "Modèle de ticket style Mikhmon (small)" },
  { id: "nanotech-normal", label: "Modèle de Ticket style nanoTECH (normal)" },
  { id: "nanotech-small", label: "Modèle de Ticket style nanoTECH (small)" },
];

export function getPresetBody(id: TicketTemplatePresetId): string {
  return BODIES[id];
}

export function getStoredTicketPresetId(): TicketTemplatePresetId {
  try {
    const v = localStorage.getItem(TICKET_PRESET_STORAGE_KEY);
    if (v === "mikhmon-small" || v === "nanotech-normal" || v === "nanotech-small") return v;
  } catch {
    /* ignore */
  }
  return DEFAULT_TICKET_PRESET_ID;
}

export function setStoredTicketPresetId(id: TicketTemplatePresetId): void {
  try {
    localStorage.setItem(TICKET_PRESET_STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

/** Repère si le contenu correspond exactement à un des trois modèles fournis. */
export function findMatchingPresetId(code: string): TicketTemplatePresetId | "custom" {
  const t = code.trim();
  for (const id of Object.keys(BODIES) as TicketTemplatePresetId[]) {
    if (BODIES[id].trim() === t) return id;
  }
  return "custom";
}
