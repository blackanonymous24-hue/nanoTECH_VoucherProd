import { useGetDashboard, useListRouterLogs } from "@workspace/api-client-react";
import { useRouterContext } from "@/contexts/RouterContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Ticket, Printer, Router, RefreshCw, ScrollText, Wifi } from "lucide-react";

const TOPIC_COLORS: Record<string, string> = {
  hotspot: "bg-blue-100 text-blue-700",
  info: "bg-gray-100 text-gray-600",
  warning: "bg-yellow-100 text-yellow-700",
  error: "bg-red-100 text-red-700",
  critical: "bg-red-200 text-red-800",
  dhcp: "bg-purple-100 text-purple-700",
  firewall: "bg-orange-100 text-orange-700",
  system: "bg-teal-100 text-teal-700",
  wireless: "bg-indigo-100 text-indigo-700",
};

function topicColor(topics: string): string {
  const parts = topics.split(",").map((t) => t.trim().toLowerCase());
  for (const t of parts) {
    if (TOPIC_COLORS[t]) return TOPIC_COLORS[t];
  }
  return "bg-gray-100 text-gray-500";
}

function topicLabel(topics: string): string {
  return topics.split(",")[0]?.trim() ?? topics;
}

export default function Dashboard() {
  const { data, isLoading, isError, refetch } = useGetDashboard();
  const { selectedRouterId } = useRouterContext();

  const {
    data: logs = [],
    isLoading: logsLoading,
    isFetching: logsFetching,
    refetch: refetchLogs,
    error: logsError,
  } = useListRouterLogs(
    selectedRouterId ?? 0,
    { limit: 60 },
    {
      query: {
        enabled: !!selectedRouterId,
        refetchInterval: 30_000,
        staleTime: 25_000,
      },
    },
  );

  const handleRefresh = () => {
    refetch();
    if (selectedRouterId) refetchLogs();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tableau de bord</h1>
          <p className="text-sm text-gray-500">Vue d&apos;ensemble de votre système</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          className="gap-1.5 text-gray-500"
          title="Rafraîchir"
        >
          <RefreshCw className={`h-4 w-4 ${logsFetching ? "animate-spin" : ""}`} />
          Actualiser
        </Button>
      </div>

      {isError && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 text-sm">
          Impossible de charger les statistiques. Vérifiez que l&apos;API est en cours d&apos;exécution.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          title="Total Vouchers"
          value={data?.totalVouchers ?? 0}
          icon={<Ticket className="h-5 w-5 text-blue-500" />}
          loading={isLoading}
        />
        <StatCard
          title="Non imprimés"
          value={data?.unprintedVouchers ?? 0}
          icon={<Ticket className="h-5 w-5 text-orange-500" />}
          loading={isLoading}
        />
        <StatCard
          title="Imprimés"
          value={data?.printedVouchers ?? 0}
          icon={<Printer className="h-5 w-5 text-green-500" />}
          loading={isLoading}
        />
        <StatCard
          title="Routeurs"
          value={data?.routerCount ?? 0}
          icon={<Router className="h-5 w-5 text-purple-500" />}
          loading={isLoading}
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <ScrollText className="h-4 w-4 text-gray-400" />
              Logs MikroTik
              {logsFetching && !logsLoading && (
                <RefreshCw className="h-3 w-3 text-gray-400 animate-spin" />
              )}
            </CardTitle>
            {logs.length > 0 && (
              <span className="text-xs text-gray-400">↻ 30s</span>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {!selectedRouterId ? (
            <div className="py-12 text-center">
              <Wifi className="h-8 w-8 text-gray-200 mx-auto mb-2" />
              <p className="text-sm text-gray-400">Sélectionnez un routeur dans la barre de gauche</p>
            </div>
          ) : logsLoading ? (
            <div className="py-8 text-center text-sm text-gray-400">
              <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-gray-300" />
              Chargement des logs...
            </div>
          ) : logsError ? (
            <div className="py-8 text-center text-sm text-red-400">
              Impossible de récupérer les logs du routeur.
            </div>
          ) : logs.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-400">Aucun log disponible.</div>
          ) : (
            <div className="divide-y divide-gray-50 max-h-[480px] overflow-y-auto font-mono text-xs">
              {logs.map((entry, i) => (
                <div
                  key={entry.id || i}
                  className="flex items-start gap-3 px-4 py-2 hover:bg-gray-50"
                >
                  <span className="text-gray-400 whitespace-nowrap pt-0.5 flex-shrink-0 w-24">
                    {entry.time}
                  </span>
                  <Badge
                    variant="outline"
                    className={`text-[10px] px-1.5 py-0 h-5 flex-shrink-0 border-0 font-medium ${topicColor(entry.topics)}`}
                  >
                    {topicLabel(entry.topics)}
                  </Badge>
                  <span className="text-gray-700 break-all leading-5">{entry.message}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
  loading,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  loading: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-gray-100 rounded-lg">{icon}</div>
          <div>
            <p className="text-xs text-gray-500 font-medium">{title}</p>
            {loading ? (
              <div className="h-7 w-12 bg-gray-200 rounded animate-pulse mt-1" />
            ) : (
              <p className="text-2xl font-bold text-gray-900">{value.toLocaleString()}</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
