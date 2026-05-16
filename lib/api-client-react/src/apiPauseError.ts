/** Même valeur que la raison d’abort dans `installAuthFetch` / `mutator`. */
export const VOUCHERNET_API_PAUSE_REASON = "api-paused";

/** Émis sur `window` quand l’API renvoie 401 avec `code: SESSION_REVOKED`. */
export const VOUCHERNET_SESSION_REVOKED_EVENT = "vouchernet-session-revoked";

export function isApiPauseError(err: unknown): boolean {
  if (!(err instanceof DOMException)) return false;
  const e = err as DOMException;
  return e.name === "AbortError" && e.message === VOUCHERNET_API_PAUSE_REASON;
}
