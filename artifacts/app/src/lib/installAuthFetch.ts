import {
  VOUCHERNET_SESSION_REVOKED_EVENT,
  type VouchernetApiPauseState,
  vouchernetPauseAllowsResolvedUrl,
} from "@workspace/api-client-react";
import { notifyRouterMikrotikBusy } from "@/lib/dashboard-resume";

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
    return u.pathname.startsWith("/api/") || u.pathname === "/api" || u.pathname.includes("/api/");
  } catch {
    return false;
  }
}

declare global {
  interface Window {
    __vouchernetAuthFetchInstalled?: boolean;
    __vouchernetApiFetchControllers?: Set<AbortController>;
    __vouchernetApiPause?: VouchernetApiPauseState;
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

function getApiPauseState(): VouchernetApiPauseState {
  if (!window.__vouchernetApiPause) {
    window.__vouchernetApiPause = { paused: false, allowPathPatterns: [] };
  }
  return window.__vouchernetApiPause;
}

const fetchUrlByController = new WeakMap<AbortController, string>();

/** Reset / prolonger / impression lot — autorisés pendant gen ou toggle paqueté. */
export const BOUTIQUE_ROUTER_ALLOW_PATH_PATTERNS: RegExp[] = [
  /\/api\/routers\/\d+\/users\/[^/?#]+\/reset(?:$|[/?#])/,
  /\/api\/routers\/\d+\/users\/[^/?#]+(?:$|[/?#])/,
  /\/api\/routers\/\d+\/lot-print(?:$|[/?#])/,
];

/** URL autorisées pendant la pause API (toggle hotspot par paquets — verrou routeur). */
export const HOTSPOT_TOGGLE_ALLOW_PATH_PATTERNS: RegExp[] = [
  /\/api\/vouchers\/users-toggle(?:$|[/?#])/,
  /\/api\/vouchers\/lot-usernames(?:$|[/?#])/,
  /\/api\/vouchers\/lot-disable(?:$|[/?#])/,
  /\/api\/routers\/\d+\/generation-lock(?:$|[/?#])/,
  /\/api\/routers\/\d+\/ping(?:$|[/?#])/,
  ...BOUTIQUE_ROUTER_ALLOW_PATH_PATTERNS,
];

/** Pause API pendant génération de tickets — gen + ping + actions boutique ciblées. */
export const GENERATION_PAUSE_ALLOW_PATH_PATTERNS: RegExp[] = [
  /\/api\/vouchers\/generate(?:$|[/?#])/,
  /\/api\/routers\/\d+\/generation-lock(?:$|[/?#])/,
  /\/api\/routers\/\d+\/ping(?:$|[/?#])/,
  /\/api\/routers\/\d+\/users(?:$|[/?#])/,
  ...BOUTIQUE_ROUTER_ALLOW_PATH_PATTERNS,
];

export function setApiRequestPause(
  paused: boolean,
  options?: { allowPathPatterns?: RegExp[]; scopeRouterId?: number | null },
): void {
  const state = getApiPauseState();
  if (!paused) {
    const prevScope = state.scopeRouterId;
    state.paused = false;
    state.allowPathPatterns = [];
    state.scopeRouterId = null;
    if (prevScope != null && Number.isFinite(prevScope)) {
      notifyRouterMikrotikBusy(prevScope, false);
    }
    return;
  }
  state.paused = true;
  state.allowPathPatterns = options?.allowPathPatterns ?? [];
  const scope = options?.scopeRouterId;
  state.scopeRouterId = scope != null && Number.isFinite(scope) ? scope : null;
  if (state.scopeRouterId != null) {
    notifyRouterMikrotikBusy(state.scopeRouterId, true);
  }
  // Ne plus annuler les fetch en cours — seules les nouvelles requêtes hors allow-list sont bloquées.
}

export function installAuthFetch(): void {
  if (window.__vouchernetAuthFetchInstalled) return;
  window.__vouchernetAuthFetchInstalled = true;
  getApiControllers();
  getApiPauseState();
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isApiRequest(input)) return original(input, init);
    let resolvedUrl = "";
    try {
      const raw =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      resolvedUrl = new URL(raw, window.location.origin).href;
    } catch {
      /* noop */
    }
    const pauseState = getApiPauseState();
    if (pauseState.paused && !vouchernetPauseAllowsResolvedUrl(pauseState, resolvedUrl)) {
      throw new DOMException(API_FETCH_PAUSED_REASON, "AbortError");
    }
    const controllers = getApiControllers();
    const ctrl = new AbortController();
    if (resolvedUrl) fetchUrlByController.set(ctrl, resolvedUrl);
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
