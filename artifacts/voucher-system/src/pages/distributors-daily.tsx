import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { 
  useGetDistributorsDailyReport, 
  getGetDistributorsDailyReportQueryKey 
} from "@workspace/api-client-react";
import { formatCurrency } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { BarChart3, TrendingUp, Wallet, Ticket, CalendarDays } from "lucide-react";

export default function DistributorsDaily() {
  const { data: report, isLoading } = useGetDistributorsDailyReport({
    query: { queryKey: getGetDistributorsDailyReportQueryKey() }
  });

  const sortedReport = report ? [...report].sort((a, b) => b.revenueToday - a.revenueToday) : [];

  const totalRevenueToday = sortedReport.reduce((sum, dist) => sum + dist.revenueToday, 0);
  const totalVouchersToday = sortedReport.reduce((sum, dist) => sum + dist.vouchersSoldToday, 0);

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Rapport Journalier</h1>
          <p className="text-muted-foreground mt-1">
            Performances des distributeurs pour aujourd'hui.
          </p>
        </div>
        <div className="flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full font-medium">
          <CalendarDays className="h-5 w-5" />
          {new Date().toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className="bg-primary text-primary-foreground">
            <CardHeader className="pb-2">
              <CardTitle className="text-primary-foreground/80 text-sm font-medium flex items-center gap-2">
                <Wallet className="h-4 w-4" /> Revenu Total Aujourd'hui
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{formatCurrency(totalRevenueToday)}</div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground text-sm font-medium flex items-center gap-2">
                <Ticket className="h-4 w-4" /> Vouchers Vendus Aujourd'hui
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{totalVouchersToday}</div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="space-y-6">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" /> Classement des Distributeurs
        </h2>
        
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : sortedReport.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Aucune donnée disponible pour aujourd'hui.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {sortedReport.map((dist, index) => (
              <Card key={dist.distributorId} className="overflow-hidden flex flex-col">
                <div className="bg-muted/50 p-4 border-b flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className={`flex items-center justify-center h-8 w-8 rounded-full font-bold text-sm ${index === 0 ? 'bg-yellow-500/20 text-yellow-600' : index === 1 ? 'bg-slate-300/50 text-slate-600' : index === 2 ? 'bg-amber-600/20 text-amber-700' : 'bg-primary/10 text-primary'}`}>
                      #{index + 1}
                    </div>
                    <div>
                      <h3 className="font-semibold">{dist.distributorName}</h3>
                      {dist.phone && <p className="text-xs text-muted-foreground">{dist.phone}</p>}
                    </div>
                  </div>
                  <Badge variant={dist.status === "active" ? "default" : "secondary"} className={dist.status === "active" ? "bg-green-500 hover:bg-green-600" : ""}>
                    {dist.status === "active" ? "Actif" : "Inactif"}
                  </Badge>
                </div>
                
                <CardContent className="p-0 flex-1">
                  <div className="grid grid-cols-2 divide-x border-b">
                    <div className="p-4 bg-primary/5">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Aujourd'hui</p>
                      <p className="text-2xl font-bold text-primary">{formatCurrency(dist.revenueToday)}</p>
                      <p className="text-sm text-muted-foreground mt-1">{dist.vouchersSoldToday} vouchers</p>
                    </div>
                    <div className="p-4">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Global</p>
                      <p className="text-xl font-bold">{formatCurrency(dist.revenueTotal)}</p>
                      <p className="text-sm text-muted-foreground mt-1">{dist.vouchersSoldTotal} vouchers</p>
                    </div>
                  </div>
                </CardContent>
                <div className="bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
                  Dernière vente : {dist.lastSaleAt ? new Date(dist.lastSaleAt).toLocaleString('fr-FR') : 'Aucune'}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
