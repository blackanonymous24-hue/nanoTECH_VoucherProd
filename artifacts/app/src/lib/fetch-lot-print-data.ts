/** Utilisateur prêt pour l’impression (tarif déjà résolu côté API). */
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
  /** Timeout ms (défaut 120 s pour gros lots). */
  timeoutMs?: number;
};

/**
 * GET /api/routers/:id/lot-print — utilisateurs + prix en un seul appel.
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

  const timeoutMs = opts?.timeoutMs ?? 120_000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const signal = opts?.signal;
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
