import { VOUCHERNET_SESSION_REVOKED_EVENT } from "@workspace/api-client-react";

const TOKEN_KEY = "vouchernet_admin_token";
const API_FETCH_ABORT_REASON = "auth-logout";
const API_FETCH_PAUSED_REASON = "api-paused";

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function isApiRequest(input: RequestInfo | URL): boolean {
  let url: string;
  if (typeof input === "string") url = input;
  else if (input instanceof URL) url = input.href;
  else url = input.url;
  if (url.startsWith("/api/") || url === "/api") return true;
  try {
    const u = new URL(url, window.location.origin);
    if (u.origin !== window.location.origin) return false;
    // Racine /api/… ou déploiement Vite avec base path : /app/api/…
    return u.pathname.startsWith("/api/") || u.pathname === "/api" || u.pathname.includes("/api/");
  } catch {
    return false;
  }
}

declare global {
  interface Window {
    __vouchernetAuthFetchInstalled?: boolean;
    __vouchernetApiFetchControllers?: Set<AbortController>;
    __vouchernetApiPause?: {
      paused: boolean;
      allowPathPatterns: RegExp[];
    };
  }
}

function getApiControllers(): Set<AbortController> {
  if (!window.__vouchernetApiFetchControllers) {
    window.__vouchernetApiFetchControllers = new Set<AbortController>();
  }
  return window.__vouchernetApiFetchControllers;
}

export function abortAllApiRequests(): void {
  const ctrls = getApiControllers();
  for (const c of ctrls) {
    try {
      c.abort(API_FETCH_ABORT_REASON);
    } catch {
      // ignore individual abort failures
    }
  }
  ctrls.clear();
}

function getApiPauseState() {
  if (!window.__vouchernetApiPause) {
    window.__vouchernetApiPause = { paused: false, allowPathPatterns: [] };
  }
  return window.__vouchernetApiPause;
}

export function setApiRequestPause(
  paused: boolean,
  options?: { allowPathPatterns?: RegExp[] },
): void {
  const state = getApiPauseState();
  state.paused = paused;
  state.allowPathPatterns = paused ? (options?.allowPathPatterns ?? []) : [];
  if (paused) {
    abortAllApiRequests();
  }
}

/**
 * Pathname réel peut être `{base}/api/...` (Vite `base` / déploiement sous-dossier).
 * Les motifs de pause autorisée ciblent `/api/...` depuis la racine site.
 */
function apiPathTailFromSitePath(pathname: string): string {
  const i = pathname.indexOf("/api/");
  return i >= 0 ? pathname.slice(i) : pathname;
}

function pathnameMatchesPausePattern(pathname: string, re: RegExp): boolean {
  return re.test(pathname) || re.test(apiPathTailFromSitePath(pathname));
}

/** URL autorisées pendant la pause API (toggle hotspot par paquets — verrou routeur). */
export const HOTSPOT_TOGGLE_ALLOW_PATH_PATTERNS: RegExp[] = [
  /\/api\/vouchers\/users-toggle(?:$|[/?#])/,
  /\/api\/vouchers\/lot-usernames(?:$|[/?#])/,
  /\/api\/vouchers\/lot-disable(?:$|[/?#])/,
  /\/api\/routers\/\d+\/generation-lock(?:$|[/?#])/,
  /\/api\/routers\/\d+\/ping(?:$|[/?#])/,
];

function getApiPath(input: RequestInfo | URL): string {
  try {
    const raw =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const u = new URL(raw, window.location.origin);
    return u.pathname;
  } catch {
    return "";
  }
}

export function installAuthFetch(): void {
  if (window.__vouchernetAuthFetchInstalled) return;
  window.__vouchernetAuthFetchInstalled = true;
  getApiControllers();
  getApiPauseState();
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isApiRequest(input)) return original(input, init);
    const pauseState = getApiPauseState();
    if (pauseState.paused) {
      const path = getApiPath(input);
      const allowed =
        pathnameMatchesPausePattern(path, /\/api\/login(?:$|[/?#])/) ||
        pathnameMatchesPausePattern(path, /\/api\/session\/revoke(?:$|[/?#])/) ||
        pauseState.allowPathPatterns.some((re) => pathnameMatchesPausePattern(path, re));
      if (!allowed) {
        throw new DOMException(API_FETCH_PAUSED_REASON, "AbortError");
      }
    }
    const controllers = getApiControllers();
    const ctrl = new AbortController();
    controllers.add(ctrl);
    const externalSignal = init?.signal;
    const relayAbort = () => {
      try { ctrl.abort(externalSignal?.reason); } catch { /* noop */ }
    };
    if (externalSignal) {
      if (externalSignal.aborted) relayAbort();
      else externalSignal.addEventListener("abort", relayAbort, { once: true });
    }
    const token = readToken();
    const existingHeaders = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (token && !existingHeaders.has("Authorization")) {
      existingHeaders.set("Authorization", `Bearer ${token}`);
    }
    // Impersonation super-admin → tenant emprunté
    const impersonateId = (window as { __vouchernetImpersonateAdminId?: number | null }).__vouchernetImpersonateAdminId;
    if (impersonateId && !existingHeaders.has("X-Impersonate-Admin")) {
      existingHeaders.set("X-Impersonate-Admin", String(impersonateId));
    }
    const nextInit: RequestInit = { ...(init ?? {}), headers: existingHeaders, signal: ctrl.signal };

    try {
      const res = await original(input, nextInit);
      if (res.status === 401) {
        const ct = res.headers.get("content-type") ?? "";
        if (ct.includes("application/json")) {
          void res
            .clone()
            .json()
            .then((body: unknown) => {
              if (
                body &&
                typeof body === "object" &&
                "code" in body &&
                (body as { code: string }).code === "SESSION_REVOKED"
              ) {
                window.dispatchEvent(new CustomEvent(VOUCHERNET_SESSION_REVOKED_EVENT));
              }
            })
            .catch(() => {});
        }
      }
      return res;
    } finally {
      controllers.delete(ctrl);
      if (externalSignal) {
        externalSignal.removeEventListener("abort", relayAbort);
      }
    }
  };
}
