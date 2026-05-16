import { isAxiosError } from "axios";

/** Même valeur que la raison d’abort dans `installAuthFetch` / `mutator`. */
export const VOUCHERNET_API_PAUSE_REASON = "api-paused";

/** Émis sur `window` quand l’API renvoie 401 avec `code: SESSION_REVOKED`. */
export const VOUCHERNET_SESSION_REVOKED_EVENT = "vouchernet-session-revoked";

/** Erreur volontaire pendant génération / toggle paqueté : ne pas l’afficher comme panne routeur. */
export function isApiPauseError(err: unknown): boolean {
  if (err instanceof DOMException) {
    return err.name === "AbortError" && err.message === VOUCHERNET_API_PAUSE_REASON;
  }
  if (err instanceof Error && err.message === VOUCHERNET_API_PAUSE_REASON) {
    return true;
  }
  if (isAxiosError(err) && err.message === VOUCHERNET_API_PAUSE_REASON) {
    return true;
  }
  const c =
    err && typeof err === "object" && "cause" in err
      ? (err as { cause: unknown }).cause
      : undefined;
  if (c !== undefined && c !== err) return isApiPauseError(c);
  return false;
}
