import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";

const TOKEN_KEY = "vouchernet_admin_token";

function rewriteApiUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  // The Orval-generated client emits paths without the /api prefix (e.g. /routers).
  // Normalise to /api/… first so the BASE_URL rewrite below always works.
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

/**
 * Inject the bearer token from localStorage/sessionStorage on every request
 * so the auto-generated React Query hooks honor the user's auth session.
 * Without this, every protected endpoint (now including GET /routers and
 * POST /routers after the multi-tenant hardening) would receive 401.
 */
apiClient.interceptors.request.use((config) => {
  if (typeof config.url === "string") {
    config.url = rewriteApiUrl(config.url);
  }
  if (typeof window === "undefined") return config;
  const token =
    window.localStorage.getItem(TOKEN_KEY) ??
    window.sessionStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers = config.headers ?? {};
    // Don't overwrite an explicitly-set Authorization header.
    if (!("Authorization" in config.headers) && !("authorization" in config.headers)) {
      (config.headers as Record<string, string>).Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

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
