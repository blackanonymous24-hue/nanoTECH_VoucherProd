import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Trophy, Medal, Users, ArrowLeft, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useRouterContext } from "@/contexts/RouterContext";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface VendorSummary {
  vendor: { id: number; name: string; phone: string | null; isActive: boolean };
  salesStats: {
    todaySold: number;
    thisMonthSold: number;
    weekSold: number;
    lastMonthSold: number;
  };
  totalVouchers: number;
  totalPrinted: number;
}

function getRankStyle(rank: number) {
  if (rank === 1) return { bg: "bg-yellow-50 border-yellow-300", badge: "bg-yellow-400 text-white", icon: <Trophy className="h-4 w-4" /> };
  if (rank === 2) return { bg: "bg-gray-50 border-gray-300", badge: "bg-gray-400 text-white", icon: <Medal className="h-4 w-4" /> };
  if (rank === 3) return { bg: "bg-orange-50 border-orange-200", badge: "bg-orange-400 text-white", icon: <Medal className="h-4 w-4" /> };
  return { bg: "bg-white border-gray-100", badge: "bg-gray-100 text-gray-600", icon: null };
}

export default function SalesRanking({ period }: { period: "daily" | "monthly" }) {
  const { selectedRouterId } = useRouterContext();
  const isDaily = period === "daily";
  const title = isDaily ? "Ventes journalières" : "Ventes mensuelles";
  const subtitle = isDaily ? "Classement du jour" : "Classement du mois en cours";
  const otherPeriod = isDaily ? "monthly" : "daily";
  const otherLabel = isDaily ? "Voir mensuel" : "Voir journalier";

  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery<VendorSummary[]>({
    queryKey: ["vendors-summary", selectedRouterId],
    queryFn: async () => {
      const url = selectedRouterId
        ? `${BASE}/api/vendors/reports/summary?routerId=${selectedRouterId}`
        : `${BASE}/api/vendors/reports/summary`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<VendorSummary[]>;
    },
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  const sorted = (data ?? [])
    .map((d) => ({ ...d, count: isDaily ? d.salesStats.todaySold : d.salesStats.thisMonthSold }))
    .sort((a, b) => b.count - a.count);

  const total = sorted.reduce((sum, d) => sum + d.count, 0);
  const updatedTime = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("fr-FR") : null;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/" className="text-gray-400 hover:text-gray-600 transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
          <p className="text-sm text-gray-500">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/sales/${otherPeriod}`}
            className="text-sm text-blue-600 hover:underline font-medium"
          >
            {otherLabel}
          </Link>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <Card className="mb-4">
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Users className="h-4 w-4 text-gray-400" />
              <span>{sorted.length} vendeur{sorted.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="text-right">
              <span className="text-xl font-bold text-gray-900">{total.toLocaleString()}</span>
              <span className="text-sm text-gray-500 ml-1">tickets vendus</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-gray-400">
            Aucun vendeur enregistré
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {sorted.map((entry, idx) => {
            const rank = idx + 1;
            const { bg, badge, icon } = getRankStyle(rank);
            const pct = total > 0 ? Math.round((entry.count / total) * 100) : 0;

            return (
              <Link key={entry.vendor.id} href={`/vendors`}>
                <div
                  className={`border rounded-xl px-4 py-3 flex items-center gap-4 cursor-pointer hover:shadow-sm transition-shadow ${bg}`}
                >
                  <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold flex-shrink-0 ${badge}`}>
                    {icon ?? rank}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <p className="font-semibold text-gray-900 truncate">{entry.vendor.name}</p>
                      <span className="text-lg font-bold text-gray-900 ml-2 flex-shrink-0">
                        {entry.count.toLocaleString()}
                        <span className="text-xs font-normal text-gray-400 ml-1">tickets vendus</span>
                      </span>
                    </div>
                    <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${rank === 1 ? "bg-yellow-400" : rank === 2 ? "bg-gray-400" : rank === 3 ? "bg-orange-400" : "bg-blue-400"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-sm text-gray-400 flex-shrink-0 w-10 text-right">{pct}%</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {updatedTime && (
        <p className="text-xs text-gray-400 text-center mt-4">Mis à jour à {updatedTime}</p>
      )}
    </div>
  );
}
