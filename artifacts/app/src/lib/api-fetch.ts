/** Racine API (même origine que le SPA, ex. "" ou "/app"). */
export function getApiBase(): string {
  const fromVite = import.meta.env.BASE_URL.replace(/\/$/, "");
  if (typeof window !== "undefined" && window.location?.origin) {
    return fromVite ? `${window.location.origin}${fromVite}` : window.location.origin;
  }
  return fromVite;
}

const DEFAULT_TIMEOUT_MS = 25_000;

/** Message utilisateur pour échec réseau fetch (hors réponse HTTP). */
export function describeFetchFailure(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "AbortError") {
      return "Délai dépassé : le serveur met trop de temps à répondre. Réessayez dans un instant.";
    }
    const m = err.message.toLowerCase();
    if (m.includes("failed to fetch") || m.includes("networkerror") || m.includes("load failed")) {
      return "Connexion bloquée (réseau ou bloqueur de pub / extension). Essayez https://nanovoucher.com en navigation privée ou désactivez le bloqueur pour ce site.";
    }
    if (m.includes("certificate") || m.includes("ssl") || m.includes("tls")) {
      return "Connexion sécurisée refusée (certificat). Ouvrez le site via https://nanovoucher.com, pas via l’IP du serveur.";
    }
  }
  return "Serveur indisponible, veuillez réessayer.";
}

export async function fetchJsonWithTimeout<T = Record<string, unknown>>(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<{ res: Response; data: T }> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchInit } = init;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${getApiBase()}${path}`, {
      ...fetchInit,
      signal: controller.signal,
    });
    let data: T;
    try {
      data = (await res.json()) as T;
    } catch {
      throw new Error("INVALID_JSON");
    }
    return { res, data };
  } finally {
    window.clearTimeout(timer);
  }
}
