import { getPresetBody, DEFAULT_TICKET_PRESET_ID } from "./voucher-ticket-presets";

/** Clé localStorage — dernier modèle PHP/HTML collé (éditeur). */
export const PHP_KEY = "vouchernet_mikhmon_ticket_php_v1";

/** Modèle de base personnalisé (prioritaire pour « Réinitialiser »). */
export const CUSTOM_DEFAULT_KEY = "vouchernet_mikhmon_ticket_custom_v1";

export function getCustomDefault(): string | null {
  try {
    const v = localStorage.getItem(CUSTOM_DEFAULT_KEY);
    return v && v.trim() ? v : null;
  } catch {
    return null;
  }
}

/** Modèle par défaut de l’app : Mikhmon (small). */
export const DEFAULT_MIKHMON_PHP = getPresetBody(DEFAULT_TICKET_PRESET_ID);
