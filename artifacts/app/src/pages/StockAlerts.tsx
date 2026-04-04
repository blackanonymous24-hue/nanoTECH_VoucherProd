import { useQuery } from "@tanstack/react-query";
import { Bell, AlertTriangle, PackageOpen } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouterContext } from "@/contexts/RouterContext";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Alert = {
  vendorId: number | null;
  vendorName: string;
  profileName: string;
  available: number;
};

function stockColor(available: number) {
  if (available === 0) return "text-red-500";
  if (available < 20) return "text-red-400";
  if (available < 50) return "text-orange-400";
  return "text-yellow-400";
}

function stockBg(available: number) {
  if (available === 0) return "bg-red-500/10 border-red-500/30";
  if (available < 20) return "bg-red-500/8 border-red-500/20";
  if (available < 50) return "bg-orange-500/8 border-orange-500/20";
  return "bg-yellow-500/8 border-yellow-500/20";
}

export default function StockAlerts() {
  const { token } = useAuth();
  const { selectedRouterId } = useRouterContext();

  const { data, isLoading } = useQuery<{ count: number; alerts: Alert[] }>({
    queryKey: ["stock-alerts", selectedRouterId],
    queryFn: async () => {
      const params = selectedRouterId ? `?routerId=${selectedRouterId}` : "";
      const res = await fetch(`${BASE}/api/vendors/stock-alerts${params}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("stock-alerts failed");
      return res.json();
    },
    staleTime: 60_000,
    enabled: !!token,
    refetchInterval: 120_000,
  });

  const alerts = data?.alerts ?? [];

  /* Group by vendor */
  const byVendor = alerts.reduce<Record<string, Alert[]>>((acc, a) => {
    const key = a.vendorName || `Vendeur #${a.vendorId}`;
    (acc[key] ??= []).push(a);
    return acc;
  }, {});

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="relative flex-shrink-0">
          <Bell className="h-6 w-6 text-red-400" />
          {alerts.length > 0 && (
            <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
            </span>
          )}
        </span>
        <div>
          <h1 className="text-lg font-semibold text-white">Alertes stock</h1>
          <p className="text-xs text-gray-500">
            Forfaits avec moins de 100 tickets disponibles
          </p>
        </div>
        {!isLoading && (
          <span className="ml-auto text-xs font-bold px-2.5 py-1 rounded-full bg-red-500/15 text-red-400 border border-red-500/20">
            {alerts.length} alerte{alerts.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex justify-center py-16 text-gray-600 text-sm">
          Chargement…
        </div>
      )}

      {/* Empty state */}
      {!isLoading && alerts.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-20 text-center">
          <PackageOpen className="h-10 w-10 text-green-500/60" />
          <p className="text-green-400 font-medium">Tous les stocks sont OK</p>
          <p className="text-xs text-gray-500">
            Aucun forfait n'a moins de 100 tickets disponibles.
          </p>
        </div>
      )}

      {/* Grouped by vendor */}
      {!isLoading && Object.entries(byVendor).map(([vendorName, items]) => (
        <div key={vendorName} className="rounded-xl border border-white/8 bg-white/[0.03] overflow-hidden">
          {/* Vendor header */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/8 bg-white/[0.02]">
            <AlertTriangle className="h-3.5 w-3.5 text-orange-400 flex-shrink-0" />
            <span className="text-sm font-semibold text-white">{vendorName}</span>
            <span className="ml-auto text-[10px] text-gray-500">
              {items.length} forfait{items.length !== 1 ? "s" : ""} en alerte
            </span>
          </div>

          {/* Profile rows */}
          <div className="divide-y divide-white/5">
            {items
              .slice()
              .sort((a, b) => a.available - b.available)
              .map((alert, i) => (
                <div
                  key={i}
                  className={`flex items-center justify-between gap-4 px-4 py-3 ${stockBg(alert.available)}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm text-gray-200 truncate">
                      {alert.profileName}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className={`text-sm font-bold tabular-nums ${stockColor(alert.available)}`}>
                      {alert.available}
                    </span>
                    <span className="text-[10px] text-gray-500">restant{alert.available !== 1 ? "s" : ""}</span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
