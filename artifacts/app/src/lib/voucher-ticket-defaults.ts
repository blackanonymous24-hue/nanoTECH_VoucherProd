import { getPresetBody, DEFAULT_TICKET_PRESET_ID, findMatchingPresetId } from "./voucher-ticket-presets";

/** Clé localStorage — dernier modèle PHP/HTML collé (éditeur). */
export const PHP_KEY = "vouchernet_mikhmon_ticket_php_v1";

/** Clé localStorage — miroir du texte actuel de l’éditeur « Modèle de ticket » (prioritaire pour l’impression). */
export const TICKET_TEMPLATE_EDITOR_LIVE_KEY = "vouchernet_ticket_template_editor_live_v1";

export function getEditorLiveTicketTemplate(): string | null {
  try {
    const raw = localStorage.getItem(TICKET_TEMPLATE_EDITOR_LIVE_KEY)?.trim();
    return raw || null;
  } catch {
    return null;
  }
}

/** Modèle de base personnalisé (uniquement si identique à l’un des 3 gabarits embarqués). */
export const CUSTOM_DEFAULT_KEY = "vouchernet_mikhmon_ticket_custom_v1";

export function getCustomDefault(): string | null {
  try {
    const raw = localStorage.getItem(CUSTOM_DEFAULT_KEY);
    if (!raw?.trim()) return null;
    const id = findMatchingPresetId(raw);
    if (id !== "custom") return getPresetBody(id);
    localStorage.removeItem(CUSTOM_DEFAULT_KEY);
    localStorage.removeItem(PHP_KEY);
    return null;
  } catch {
    return null;
  }
}

/** Modèle par défaut de l’app : Mikhmon (small). */
export const DEFAULT_MIKHMON_PHP = getPresetBody(DEFAULT_TICKET_PRESET_ID);
