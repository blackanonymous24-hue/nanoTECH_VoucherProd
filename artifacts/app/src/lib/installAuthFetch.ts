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
    return u.origin === window.location.origin && u.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

/** `fetch` navigateur d’origine, avant notre patch (connexion, etc.). */
let nativeFetchRef: typeof fetch | null = null;

/**
 * Appels qui doivent ignorer pause API, en-tête Bearer automatique et AbortController global
 * — typiquement `POST /api/login` depuis la page de connexion.
 */
export function fetchWithoutInterceptors(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (nativeFetchRef) return nativeFetchRef(input, init);
  return window.fetch(input, init);
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

/** Connexion / endpoints publics : ne jamais bloquer pendant la pause génération (sinon login « impossible de contacter »). */
const API_PAUSE_PUBLIC_PATHS: RegExp[] = [
  /\/api\/login(?:$|\/|\?)/,
  /\/api\/vendor-portal\/login(?:$|\/|\?)/,
];

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

/** Réinitialise la pause (ex. après déconnexion ou chargement de l’app si état coincé). */
export function clearApiRequestPause(): void {
  setApiRequestPause(false);
}

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
  nativeFetchRef = original;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isApiRequest(input)) return original(input, init);
    const pauseState = getApiPauseState();
    if (pauseState.paused) {
      const path = getApiPath(input);
      const allowed =
        API_PAUSE_PUBLIC_PATHS.some((re) => re.test(path)) ||
        pauseState.allowPathPatterns.some((re) => re.test(path));
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
    const nextInit: RequestInit = { ...(init ?? {}), headers: existingHeaders, signal: ctrl.signal };

    try {
      return await original(input, nextInit);
    } finally {
      controllers.delete(ctrl);
      if (externalSignal) {
        externalSignal.removeEventListener("abort", relayAbort);
      }
    }
  };
}
