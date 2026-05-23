import { queryClient } from "@/lib/queryClient";
import type { VendorRankingRow } from "@/lib/dashboard-priority";
import { UNATTRIBUTED_VENDOR_ID } from "@/lib/dashboard-priority";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface VendorSummaryRow {
  vendor: { id: number; name: string; phone: string | null; isActive: boolean };
  salesStats: {
    todaySold: number;
    todayAmount: number;
    yesterdaySold: number;
    yesterdayAmount: number;
    weekSold: number;
    weekAmount: number;
    lastWeekSold: number;
    lastWeekAmount: number;
    thisMonthSold: number;
    thisMonthAmount: number;
    lastMonthSold: number;
    lastMonthAmount: number;
  };
  totalVouchers: number;
  totalPrinted: number;
}

const EMPTY_STATS = {
  yesterdaySold: 0,
  yesterdayAmount: 0,
  weekSold: 0,
  weekAmount: 0,
  lastWeekSold: 0,
  lastWeekAmount: 0,
  lastMonthSold: 0,
  lastMonthAmount: 0,
};

/** Convertit le classement dashboard-priority en résumé vendeurs (affichage instantané). */
export function vendorRankingToSummary(rows: VendorRankingRow[]): VendorSummaryRow[] {
  return rows.map((r) => ({
    vendor: {
      id: r.vendorId,
      name: r.name,
      phone: null,
      isActive: true,
    },
    totalVouchers: 0,
    totalPrinted: 0,
    salesStats: {
      ...EMPTY_STATS,
      todaySold: r.dailySold,
      todayAmount: r.dailyAmount ?? 0,
      thisMonthSold: r.monthlySold,
      thisMonthAmount: r.monthlyAmount ?? 0,
    },
  }));
}

export function prefetchVendorsSalesSummary(routerId: number, ranking?: VendorRankingRow[] | null): void {
  const qk = ["vendors-summary", routerId] as const;
  if (ranking?.length) {
    queryClient.setQueryData(qk, vendorRankingToSummary(ranking));
  }
  void fetch(`${BASE}/api/vendors/reports/summary?routerId=${routerId}`)
    .then(async (res) => {
      if (!res.ok) return;
      const data = (await res.json()) as VendorSummaryRow[];
      queryClient.setQueryData(qk, data);
    })
    .catch(() => { /* cache dashboard suffit */ });
}

export function prefetchVendorPeriodReports(
  routerId: number,
  vendorIds: Array<{ id: number; name: string }>,
  period: "today" | "month",
): void {
  for (const v of vendorIds) {
    if (v.id === UNATTRIBUTED_VENDOR_ID) {
      queryClient.prefetchQuery({
        queryKey: ["unattributed-period-sales", routerId, period],
        queryFn: async ({ signal }) => {
          const res = await fetch(
            `${BASE}/api/routers/${routerId}/unattributed-period-sales?period=${period}`,
            { signal },
          );
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        },
        staleTime: 60_000,
      });
      continue;
    }
    queryClient.prefetchQuery({
      queryKey: ["vendor-period-sales", v.id, period],
      queryFn: async ({ signal }) => {
        const res = await fetch(`${BASE}/api/vendors/${v.id}/period-sales?period=${period}`, { signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      },
      staleTime: 60_000,
    });
  }
}
