/** Cache local portail vendeur — affichage instantané au retour sur /vendeur. */

const DASH_KEY = "vendor-portal-dash:v1";
const MAX_AGE_MS = 30 * 60_000;

type VendorInfo = { id: number; name: string; email: string | null; username: string | null };

export type VendorPortalCacheBundle = {
  token: string;
  vendorId: number;
  savedAt: number;
  data: unknown;
  versData: unknown;
  arrearsData: unknown;
};

function storageKey(vendorId: number) {
  return `${DASH_KEY}:${vendorId}`;
}

export function readVendorPortalCache(token: string, vendorId: number): VendorPortalCacheBundle | null {
  try {
    const raw = localStorage.getItem(storageKey(vendorId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VendorPortalCacheBundle;
    if (!parsed || parsed.token !== token || parsed.vendorId !== vendorId) return null;
    if (Date.now() - parsed.savedAt > MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeVendorPortalCache(
  token: string,
  vendorId: number,
  bundle: Pick<VendorPortalCacheBundle, "data" | "versData" | "arrearsData">,
): void {
  try {
    const payload: VendorPortalCacheBundle = {
      token,
      vendorId,
      savedAt: Date.now(),
      data: bundle.data,
      versData: bundle.versData,
      arrearsData: bundle.arrearsData,
    };
    localStorage.setItem(storageKey(vendorId), JSON.stringify(payload));
  } catch {
    /* quota */
  }
}

export async function warmVendorPortalDashboard(token: string): Promise<void> {
  const headers = { Authorization: `Bearer ${token}` };
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
  try {
    const res = await fetch(`${BASE}/api/vendor-portal/me`, { headers });
    if (!res.ok) return;
    const data = await res.json();
    const vendorId = (data as { vendor?: VendorInfo })?.vendor?.id;
    if (!vendorId) return;
    writeVendorPortalCache(token, vendorId, { data, versData: null, arrearsData: null });
    void Promise.allSettled([
      fetch(`${BASE}/api/vendor-portal/me/payments`, { headers }).then(async (r) => {
        if (r.ok) {
          const vers = await r.json();
          const prev = readVendorPortalCache(token, vendorId);
          writeVendorPortalCache(token, vendorId, {
            data: prev?.data ?? data,
            versData: vers,
            arrearsData: prev?.arrearsData ?? null,
          });
        }
      }),
      fetch(`${BASE}/api/vendor-portal/me/daily-arrears`, { headers }).then(async (r) => {
        if (r.ok) {
          const arrears = await r.json();
          const prev = readVendorPortalCache(token, vendorId);
          writeVendorPortalCache(token, vendorId, {
            data: prev?.data ?? data,
            versData: prev?.versData ?? null,
            arrearsData: arrears,
          });
        }
      }),
    ]);
  } catch {
    /* ignore */
  }
}
