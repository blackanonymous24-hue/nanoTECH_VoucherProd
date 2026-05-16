/**
 * Pause API « paquetée » (génération / toggle hotspot) : option pour ne bloquer
 * que le traffic identifié comme ciblant un routeur donné, afin de ne pas casser
 * les autres onglets / autres routeurs.
 */
export type VouchernetApiPauseState = {
  paused: boolean;
  allowPathPatterns: RegExp[];
  /** Si défini, les requêtes qui ciblent un autre routeur (path/query) ne sont pas soumises à la pause. */
  scopeRouterId?: number | null;
};

function apiPathTailFromSitePath(pathname: string): string {
  const i = pathname.indexOf("/api/");
  return i >= 0 ? pathname.slice(i) : pathname;
}

export function pathnameMatchesPausePattern(pathname: string, re: RegExp): boolean {
  return re.test(pathname) || re.test(apiPathTailFromSitePath(pathname));
}

type ParsedTarget = { kind: "router"; id: number } | { kind: "global" };

function parseApiRequestRouterTarget(resolvedUrl: string): ParsedTarget {
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const u = new URL(resolvedUrl, base);
    const tail = apiPathTailFromSitePath(u.pathname);
    const m = tail.match(/^\/api\/routers\/(\d+)(?:\/|$)/);
    if (m) return { kind: "router", id: parseInt(m[1], 10) };
    const sp = u.searchParams.get("routerId");
    if (sp && /^\d+$/.test(sp)) return { kind: "router", id: parseInt(sp, 10) };
    return { kind: "global" };
  } catch {
    return { kind: "global" };
  }
}

/** Requête identifiée comme concernant le routeur soumis à la pause (pour annulation ciblée). */
export function resolvedUrlIsSubjectToScopedPause(resolvedUrl: string, scopeRouterId: number): boolean {
  if (!Number.isFinite(scopeRouterId)) return true;
  const t = parseApiRequestRouterTarget(resolvedUrl);
  if (t.kind === "global") return false;
  return t.id === scopeRouterId;
}

/** true = cette requête ne doit pas être soumise à la pause (autre routeur ou hors scope routeur). */
export function vouchernetPauseBypassesForScopedRouter(
  state: VouchernetApiPauseState,
  resolvedUrl: string,
): boolean {
  const scope = state.scopeRouterId;
  if (scope == null || !Number.isFinite(scope)) return false;
  const t = parseApiRequestRouterTarget(resolvedUrl);
  if (t.kind === "global") return true;
  return t.id !== scope;
}

export function vouchernetPauseAllowsResolvedUrl(
  state: VouchernetApiPauseState | undefined,
  resolvedUrl: string,
): boolean {
  if (!state?.paused) return true;
  if (!resolvedUrl) return false;
  if (vouchernetPauseBypassesForScopedRouter(state, resolvedUrl)) return true;
  const path = (() => {
    try {
      const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
      return new URL(resolvedUrl, base).pathname;
    } catch {
      return "";
    }
  })();
  if (pathnameMatchesPausePattern(path, /\/api\/login(?:$|[/?#])/)) return true;
  if (pathnameMatchesPausePattern(path, /\/api\/session\/revoke(?:$|[/?#])/)) return true;
  return state.allowPathPatterns.some((re) => pathnameMatchesPausePattern(path, re));
}
