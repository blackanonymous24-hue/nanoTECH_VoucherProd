const TOKEN_KEY = "vouchernet_admin_token";

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

declare global {
  interface Window {
    __vouchernetAuthFetchInstalled?: boolean;
  }
}

export function installAuthFetch(): void {
  if (window.__vouchernetAuthFetchInstalled) return;
  window.__vouchernetAuthFetchInstalled = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isApiRequest(input)) return original(input, init);
    const token = readToken();
    if (!token) return original(input, init);

    const existingHeaders = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!existingHeaders.has("Authorization")) {
      existingHeaders.set("Authorization", `Bearer ${token}`);
    }
    const nextInit: RequestInit = { ...(init ?? {}), headers: existingHeaders };
    return original(input, nextInit);
  };
}
