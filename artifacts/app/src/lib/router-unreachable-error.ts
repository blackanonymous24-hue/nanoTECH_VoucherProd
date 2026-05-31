/** Erreurs API qui ressemblent à un 502 mais ne signifient pas « routeur hors ligne ». */
export function isTransientMikrotikApiMessage(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes("client disconnected") ||
    lower.includes("connexion interrompue") ||
    lower.includes("router queue timeout")
  );
}

function errorMessage(err: unknown): string {
  if (!err || typeof err !== "object") return "";
  const e = err as Record<string, unknown>;
  const direct = String(e.message ?? "");
  const response = e.response as Record<string, unknown> | undefined;
  const data = response?.data as Record<string, unknown> | undefined;
  const fromBody = data?.error != null ? String(data.error) : "";
  return fromBody || direct;
}

/** true = routeur probablement injoignable (réseau / MikroTik down), pas une erreur transitoire serveur. */
export function isRouterUnreachableApiError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;
  if (e.name === "AbortError") return false;

  const msg = errorMessage(err);
  if (msg && isTransientMikrotikApiMessage(msg)) return false;

  const response = e.response as Record<string, unknown> | undefined;
  if (response?.status === 502) return true;

  const lower = msg.toLowerCase();
  return (
    (lower.includes("502") && !isTransientMikrotikApiMessage(msg)) ||
    lower.includes("contacter") ||
    lower.includes("unreachable") ||
    lower.includes("network error") ||
    lower.includes("failed to fetch") ||
    lower.includes("load failed")
  );
}
