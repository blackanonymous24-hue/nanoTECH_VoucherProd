/** Aligné avec `installAuthFetch` (fetch) et `mutator` (Axios) — requêtes bloquées pendant toggle / génération. */
export const VOUCHERNET_API_PAUSE_REASON = "api-paused";

export function isApiPausedAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { name?: string; message?: string; cause?: unknown };
  if (e.name === "AbortError" && e.message === VOUCHERNET_API_PAUSE_REASON) return true;
  if (e.cause !== undefined && e.cause !== error) return isApiPausedAbortError(e.cause);
  return false;
}
