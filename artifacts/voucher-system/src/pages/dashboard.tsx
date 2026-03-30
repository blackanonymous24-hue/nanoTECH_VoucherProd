import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useGetDashboardStats, getGetDashboardStatsQueryKey, useGetRecentSales, getGetRecentSalesQueryKey, useGetVouchersByProfile, getGetVouchersByProfileQueryKey } from "@workspace/api-client-react";
import { formatCurrency } from "@/lib/format";
import { TrendingUp, Ticket, ShoppingCart, Wifi } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function Dashboard() {
  const { data: stats, isLoading: isLoadingStats } = useGetDashboardStats({
    query: { queryKey: getGetDashboardStatsQueryKey() }
  });
  
  const { data: recentSales, isLoading: isLoadingSales } = useGetRecentSales({
    query: { queryKey: getGetRecentSalesQueryKey() }
  });

  const { data: profileStats, isLoading: isLoadingProfiles } = useGetVouchersByProfile({
    query: { queryKey: getGetVouchersByProfileQueryKey() }
  });

  // Prepare chart data grouping by date
  const chartData = (recentSales || []).reduce((acc: any[], sale) => {
    const date = new Date(sale.createdAt).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' });
    const existing = acc.find(item => item.date === date);
    if (existing) {
      existing.total += sale.amount;
    } else {
      acc.push({ date, total: sale.amount });
    }
    return acc;
  }, []).reverse(); // Assuming recent sales are desc, reverse for chronological chart

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Tableau de bord</h1>
        <p className="text-muted-foreground mt-1">Aperçu de vos ventes et de l'état de votre réseau.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Revenus du jour</CardTitle>
            <TrendingUp className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {isLoadingStats ? <Skeleton className="h-8 w-24" /> : (
              <div className="text-2xl font-bold">{formatCurrency(stats?.revenueToday || 0)}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Sur un total de {formatCurrency(stats?.totalRevenue || 0)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Vendus aujourd'hui</CardTitle>
            <ShoppingCart className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {isLoadingStats ? <Skeleton className="h-8 w-16" /> : (
              <div className="text-2xl font-bold">{stats?.vouchersSoldToday || 0}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Total historique : {stats?.vouchersSoldTotal || 0}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Vouchers disponibles</CardTitle>
            <Ticket className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {isLoadingStats ? <Skeleton className="h-8 w-16" /> : (
              <div className="text-2xl font-bold">{stats?.vouchersAvailable || 0}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Prêts à être vendus
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Profils actifs</CardTitle>
            <Wifi className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {isLoadingStats ? <Skeleton className="h-8 w-16" /> : (
              <div className="text-2xl font-bold">{stats?.totalProfiles || 0}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Forfaits configurés
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Revenus récents</CardTitle>
            <CardDescription>Aperçu des revenus sur les dernières ventes</CardDescription>
          </CardHeader>
          <CardContent className="pl-0">
            {isLoadingSales ? (
              <div className="h-[300px] flex items-center justify-center">
                <Skeleton className="h-[250px] w-full ml-4" />
              </div>
            ) : chartData.length > 0 ? (
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis 
                      dataKey="date" 
                      tickLine={false} 
                      axisLine={false} 
                      fontSize={12} 
                      tickMargin={10} 
                      stroke="hsl(var(--muted-foreground))"
                    />
                    <YAxis 
                      tickLine={false} 
                      axisLine={false} 
                      fontSize={12}
                      tickMargin={10} 
                      tickFormatter={(value) => `${value}`}
                      stroke="hsl(var(--muted-foreground))"
                    />
                    <Tooltip 
                      cursor={{fill: 'hsl(var(--muted))'}}
                      contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))' }}
                      formatter={(value: number) => [formatCurrency(value), "Revenu"]}
                    />
                    <Bar dataKey="total" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                Aucune donnée de vente récente
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>État par Forfait</CardTitle>
            <CardDescription>Stock de vouchers par profil</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingProfiles ? (
              <div className="space-y-4">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : profileStats && profileStats.length > 0 ? (
              <div className="space-y-4">
                {profileStats.map((stat) => {
                  const total = stat.available + stat.sold;
                  const percentage = total > 0 ? (stat.available / total) * 100 : 0;
                  
                  return (
                    <div key={stat.profileId} className="flex flex-col gap-2">
                      <div className="flex justify-between items-center text-sm">
                        <span className="font-medium">{stat.profileName}</span>
                        <span className="text-muted-foreground">
                          {stat.available} dispo. / {stat.sold} vendus
                        </span>
                      </div>
                      <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                        <div 
                          className={`h-full rounded-full ${percentage < 20 ? 'bg-destructive' : 'bg-primary'}`}
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-8 text-center text-muted-foreground">
                Aucun profil configuré.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
