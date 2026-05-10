import { useQuery } from "@tanstack/react-query";
import { withApiPauseCacheFallback } from "@/lib/queryFnApiPauseCache";
import { Bell, PackageOpen, AlertTriangle, RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouterContext } from "@/contexts/RouterContext";
import { usePageVisibility } from "@/hooks/use-page-visibility";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Alert = {
  vendorId: number | null;
  vendorName: string;
  profileName: string;
  available: number;
};

function StockBadge({ available }: { available: number }) {
  if (available === 0)
    return <Badge className="bg-red-100 text-red-700 border border-red-200 font-bold">0 restant</Badge>;
  if (available < 20)
    return <Badge className="bg-red-100 text-red-700 border border-red-200 font-bold">{available} restants</Badge>;
  if (available < 50)
    return <Badge className="bg-orange-100 text-orange-700 border border-orange-200 font-bold">{available} restants</Badge>;
  return <Badge className="bg-yellow-100 text-yellow-700 border border-yellow-200 font-bold">{available} restants</Badge>;
}

function urgencyColor(available: number) {
  if (available === 0) return "border-l-red-600 bg-red-50";
  if (available < 20) return "border-l-red-400 bg-red-50";
  if (available < 50) return "border-l-orange-400 bg-orange-50";
  return "border-l-yellow-400 bg-yellow-50";
}

export default function StockAlerts() {
  const { token } = useAuth();
  const { selectedRouterId } = useRouterContext();
  const isVisible = usePageVisibility();

  const { data, isLoading, refetch, isFetching } = useQuery<{
    count: number;
    alerts: Alert[];
  }>({
    queryKey: ["stock-alerts", selectedRouterId],
    queryFn: withApiPauseCacheFallback(async ({ signal }) => {
      const params = selectedRouterId ? `?routerId=${selectedRouterId}` : "";
      const res = await fetch(`${BASE}/api/vendors/stock-alerts${params}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal,
      });
      if (!res.ok) throw new Error("stock-alerts failed");
      return res.json();
    }),
    staleTime: 60_000,
    enabled: !!token && isVisible,
    refetchInterval: isVisible ? 120_000 : false,
    refetchIntervalInBackground: false,
  });

  const alerts = data?.alerts ?? [];

  /* Group by vendor, sorted by worst stock first */
  const byVendor = Object.entries(
    alerts.reduce<Record<string, Alert[]>>((acc, a) => {
      const key = a.vendorName || `Vendeur #${a.vendorId}`;
      (acc[key] ??= []).push(a);
      return acc;
    }, {})
  ).map(([name, items]) => ({
    name,
    items: [...items].sort((a, b) => a.available - b.available),
    worstStock: Math.min(...items.map((i) => i.available)),
  })).sort((a, b) => a.worstStock - b.worstStock);

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Bell className="h-6 w-6 text-red-500" />
            Alertes de stock
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {!isLoading && alerts.length > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-100 border border-red-200 text-red-700 text-sm font-semibold">
              <AlertTriangle className="h-4 w-4" />
              {alerts.length} alerte{alerts.length !== 1 ? "s" : ""}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            disabled={isFetching}
            className=""
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <Card>
          <CardContent className="py-6 space-y-3">
            <Skeleton className="h-5 w-48 mx-auto" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!isLoading && alerts.length === 0 && (
        <Card>
          <CardContent className="py-20 text-center">
            <PackageOpen className="h-12 w-12 text-green-400 mx-auto mb-4" />
            <p className="text-green-700 font-semibold text-base">Tous les stocks sont OK</p>
            <p className="text-sm text-gray-400 mt-1">
              Aucun forfait n'a moins de 100 tickets disponibles.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Vendor cards */}
      {!isLoading && byVendor.map(({ name, items }) => (
        <Card key={name} className="overflow-hidden shadow-sm">
          <CardHeader className="py-3 px-4 border-b bg-gray-50">
            <CardTitle className="text-sm font-semibold text-gray-800 flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 min-w-0">
                <AlertTriangle className="h-4 w-4 text-orange-500 flex-shrink-0" />
                <span className="truncate">{name}</span>
              </span>
              <span className="text-xs font-normal text-gray-500 flex-shrink-0">
                {items.length} forfait{items.length !== 1 ? "s" : ""} en alerte
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-gray-100">
              {items.map((alert, i) => (
                <div
                  key={i}
                  className={`flex items-center justify-between gap-2 px-4 py-3 border-l-4 ${urgencyColor(alert.available)}`}
                >
                  <span className="text-sm font-medium text-gray-800 truncate min-w-0">
                    {alert.profileName}
                  </span>
                  <div className="flex-shrink-0"><StockBadge available={alert.available} /></div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
