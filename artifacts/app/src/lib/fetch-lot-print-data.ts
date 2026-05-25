/** Utilisateur prêt pour l'impression (tarif déjà résolu côté API). */
export type LotPrintUser = {
  username: string;
  password: string;
  profile: string;
  comment: string | null;
  limitUptime: string | null;
  limitBytesTotal: string | null;
  price: string;
  validity: string;
};

export type FetchLotPrintDataOpts = {
  /** true = recharge MikroTik (lent, gros lots) ; false = cache (défaut). */
  refresh?: boolean;
  fallbackPrice?: string;
  fallbackValidity?: string;
  signal?: AbortSignal;
  /** Timeout ms par tentative (défaut 150 s — reprises serveur incluses). */
  timeoutMs?: number;
};

function isRetryableLotPrintError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  return msg.includes("timed out")
    || msg.includes("timeout")
    || msg.includes("délai dépassé")
    || msg.includes("delai depasse")
    || msg.includes("502")
    || msg.includes("503")
    || msg.includes("504")
    || msg.includes("rate exceeded")
    || msg.includes("injoignable");
}

async function fetchLotPrintDataOnce(
  base: string,
  routerId: number,
  params: URLSearchParams,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<LotPrintUser[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }

  try {
    const res = await fetch(`${base}/api/routers/${routerId}/lot-print?${params}`, {
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }
    const data = (await res.json()) as { users?: LotPrintUser[] };
    return data.users ?? [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET /api/routers/:id/lot-print — utilisateurs + prix en un seul appel.
 * Rejoue automatiquement sur timeout routeur (2 tentatives supplémentaires).
 */
export async function fetchLotPrintData(
  base: string,
  routerId: number,
  comment: string,
  opts?: FetchLotPrintDataOpts,
): Promise<LotPrintUser[]> {
  const params = new URLSearchParams({ comment });
  if (opts?.fallbackPrice) params.set("fallbackPrice", opts.fallbackPrice);
  if (opts?.fallbackValidity) params.set("fallbackValidity", opts.fallbackValidity);
  if (opts?.refresh) params.set("refresh", "1");

  const timeoutMs = opts?.timeoutMs ?? 150_000;
  const maxAttempts = 3;
  let lastErr: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fetchLotPrintDataOnce(base, routerId, params, timeoutMs, opts?.signal);
    } catch (err) {
      lastErr = err;
      const aborted = err instanceof DOMException && err.name === "AbortError";
      if (aborted && opts?.signal?.aborted) throw err;
      if (attempt >= maxAttempts - 1 || !isRetryableLotPrintError(err)) throw err;
      await new Promise<void>((r) => setTimeout(r, 1200 * (attempt + 1)));
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error("Impression impossible");
}
