import axios, { type AxiosRequestConfig, type AxiosResponse, isAxiosError } from "axios";
import { VOUCHERNET_API_PAUSE_REASON, VOUCHERNET_SESSION_REVOKED_EVENT } from "./apiPauseError";
import { type VouchernetApiPauseState, vouchernetPauseAllowsResolvedUrl } from "./apiPauseScope";

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

function voucherNetApiPauseAllowsResolvedUrl(resolvedUrl: string): boolean {
  try {
    const w = window as Window & { __vouchernetApiPause?: VouchernetApiPauseState };
    return vouchernetPauseAllowsResolvedUrl(w.__vouchernetApiPause, resolvedUrl);
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
  const impersonateId = (window as { __vouchernetImpersonateAdminId?: number | null }).__vouchernetImpersonateAdminId;
  if (impersonateId != null && Number.isFinite(impersonateId)) {
    config.headers = config.headers ?? {};
    const h = config.headers as Record<string, string>;
    if (!h["X-Impersonate-Admin"] && !h["x-impersonate-admin"]) {
      h["X-Impersonate-Admin"] = String(impersonateId);
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
