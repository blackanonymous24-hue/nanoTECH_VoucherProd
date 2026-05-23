import { queryClient } from "@/lib/queryClient";
import type { VendorSummary } from "@workspace/api-client-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const REPORTS_CACHE_KEY = "reports-summary-cache:v1";
const MAX_AGE_MS = 30 * 60_000;

export function reportsSummaryQueryKey(routerId: number) {
  return ["vendors-summary", routerId] as const;
}

export function readReportsSummaryCache(routerId: number): VendorSummary[] | null {
  try {
    const raw = localStorage.getItem(`${REPORTS_CACHE_KEY}:${routerId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt: number; rows: VendorSummary[] };
    if (!parsed?.rows || Date.now() - parsed.savedAt > MAX_AGE_MS) return null;
    return parsed.rows;
  } catch {
    return null;
  }
}

export function writeReportsSummaryCache(routerId: number, rows: VendorSummary[]): void {
  try {
    localStorage.setItem(
      `${REPORTS_CACHE_KEY}:${routerId}`,
      JSON.stringify({ savedAt: Date.now(), rows }),
    );
  } catch {
    /* ignore */
  }
}

export function prefetchReportsSummary(routerId: number): void {
  const qk = reportsSummaryQueryKey(routerId);
  const cached = readReportsSummaryCache(routerId);
  if (cached?.length) {
    queryClient.setQueryData(qk, cached);
  }
  void fetch(`${BASE}/api/vendors/reports/summary?routerId=${routerId}`)
    .then(async (res) => {
      if (!res.ok) return;
      const data = (await res.json()) as VendorSummary[];
      queryClient.setQueryData(qk, data);
      if (data.length) writeReportsSummaryCache(routerId, data);
    })
    .catch(() => { /* cache local suffit */ });
}
