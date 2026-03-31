import { useGetDashboard } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Ticket, Printer, Router, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

export default function Dashboard() {
  const { data, isLoading, isError, refetch } = useGetDashboard();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tableau de bord</h1>
          <p className="text-sm text-gray-500">Vue d&apos;ensemble de votre système</p>
        </div>
        <button
          onClick={() => refetch()}
          className="p-2 rounded-lg hover:bg-gray-200 text-gray-500"
          title="Rafraîchir"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {isError && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 text-sm">
          Impossible de charger les statistiques. Vérifiez que l&apos;API est en cours d&apos;exécution.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <StatCard
          title="Total Vouchers"
          value={data?.totalVouchers ?? 0}
          icon={<Ticket className="h-5 w-5 text-blue-500" />}
          color="blue"
          loading={isLoading}
        />
        <StatCard
          title="Non imprimés"
          value={data?.unprintedVouchers ?? 0}
          icon={<Ticket className="h-5 w-5 text-orange-500" />}
          color="orange"
          loading={isLoading}
        />
        <StatCard
          title="Imprimés"
          value={data?.printedVouchers ?? 0}
          icon={<Printer className="h-5 w-5 text-green-500" />}
          color="green"
          loading={isLoading}
        />
        <StatCard
          title="Routeurs"
          value={data?.routerCount ?? 0}
          icon={<Router className="h-5 w-5 text-purple-500" />}
          color="purple"
          loading={isLoading}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vouchers récents</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-gray-400">Chargement...</div>
          ) : !data?.recentVouchers?.length ? (
            <div className="text-sm text-gray-400">Aucun voucher généré pour l&apos;instant.</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {data.recentVouchers.map((v) => (
                <div key={v.id} className="flex items-center justify-between py-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{v.username}</span>
                      <span className="text-gray-400 text-xs">/ {v.password}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {v.profileName} {v.validity && <span>· {v.validity}</span>}
                      {v.price && <span>· {v.price}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {v.printedAt ? (
                      <Badge variant="outline" className="text-green-600 border-green-200 text-xs">Imprimé</Badge>
                    ) : (
                      <Badge variant="outline" className="text-orange-600 border-orange-200 text-xs">En attente</Badge>
                    )}
                    <span className="text-xs text-gray-400">
                      {formatDistanceToNow(new Date(v.createdAt), { addSuffix: true, locale: fr })}
                    </span>
                  </div>
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
  color: string;
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
