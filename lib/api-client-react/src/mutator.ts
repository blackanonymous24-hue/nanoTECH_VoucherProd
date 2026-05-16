import axios, { type AxiosRequestConfig, type AxiosResponse, isAxiosError } from "axios";
import { VOUCHERNET_API_PAUSE_REASON, VOUCHERNET_SESSION_REVOKED_EVENT } from "./apiPauseError";

const TOKEN_KEY = "vouchernet_admin_token";

function rewriteApiUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  if (url.startsWith("/") && !url.startsWith("/api")) {
    url = "/api" + url;
  }
  if (url !== "/api" && !url.startsWith("/api/")) return url;
  const base = ((import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/").replace(/\/$/, "");
  const prefix = base ? `${base}/api` : "/api";
  return url.replace(/^\/api/, prefix);
}

const apiClient = axios.create({
  baseURL: "",
});

function apiPathTailFromSitePath(pathname: string): string {
  const i = pathname.indexOf("/api/");
  return i >= 0 ? pathname.slice(i) : pathname;
}

function pathnameMatchesPausePattern(pathname: string, re: RegExp): boolean {
  return re.test(pathname) || re.test(apiPathTailFromSitePath(pathname));
}

function voucherNetApiPauseAllowsResolvedUrl(resolvedUrl: string): boolean {
  try {
    const w = window as Window & {
      __vouchernetApiPause?: { paused: boolean; allowPathPatterns: RegExp[] };
    };
    const state = w.__vouchernetApiPause;
    if (!state?.paused) return true;
    const path = new URL(resolvedUrl, window.location.origin).pathname;
    if (pathnameMatchesPausePattern(path, /\/api\/login(?:$|[/?#])/)) return true;
    if (pathnameMatchesPausePattern(path, /\/api\/session\/revoke(?:$|[/?#])/)) return true;
    return state.allowPathPatterns.some((re) => pathnameMatchesPausePattern(path, re));
  } catch {
    return true;
  }
}

apiClient.interceptors.request.use((config) => {
  if (typeof config.url === "string") {
    config.url = rewriteApiUrl(config.url);
  }
  if (typeof window !== "undefined" && config.url) {
    try {
      const resolved = new URL(config.url, window.location.origin).href;
      if (!voucherNetApiPauseAllowsResolvedUrl(resolved)) {
        return Promise.reject(new DOMException(VOUCHERNET_API_PAUSE_REASON, "AbortError"));
      }
    } catch {
      /* ignore */
    }
  }
  if (typeof window === "undefined") return config;
  const token =
    window.localStorage.getItem(TOKEN_KEY) ??
    window.sessionStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers = config.headers ?? {};
    if (!("Authorization" in config.headers) && !("authorization" in config.headers)) {
      (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

apiClient.interceptors.response.use(
  (r) => r,
  (err: unknown) => {
    if (typeof window !== "undefined" && isAxiosError(err) && err.response?.status === 401) {
      const data = err.response?.data as { code?: string } | undefined;
      if (data?.code === "SESSION_REVOKED") {
        window.dispatchEvent(new CustomEvent(VOUCHERNET_SESSION_REVOKED_EVENT));
      }
    }
    return Promise.reject(err);
  },
);

export const customInstance = async <T>(
  config: AxiosRequestConfig,
  options?: AxiosRequestConfig,
): Promise<T> => {
  const response: AxiosResponse<T> = await apiClient({
    ...config,
    ...options,
  });
  return response.data;
};

export default customInstance;
