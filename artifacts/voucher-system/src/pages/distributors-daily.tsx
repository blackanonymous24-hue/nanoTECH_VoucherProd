import {
  useGetDistributorsDailyReport,
  getGetDistributorsDailyReportQueryKey
} from "@workspace/api-client-react";
import { formatCurrency } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Wallet, Ticket, CalendarDays } from "lucide-react";

const periods = [
  { key: "Today",        label: "Aujourd'hui",       revKey: "revenueToday",         qtyKey: "vouchersSoldToday",         accent: true },
  { key: "Yesterday",    label: "Hier",               revKey: "revenueYesterday",      qtyKey: "vouchersSoldYesterday",      accent: false },
  { key: "LastWeek",     label: "Semaine préc.",      revKey: "revenueLastWeek",       qtyKey: "vouchersSoldLastWeek",       accent: false },
  { key: "CurrentMonth", label: "Mois en cours",      revKey: "revenueCurrentMonth",   qtyKey: "vouchersSoldCurrentMonth",   accent: false },
] as const;

type ReportItem = {
  distributorId: number;
  distributorName: string;
  phone?: string | null;
  status: string;
  revenueToday: number;
  vouchersSoldToday: number;
  revenueYesterday: number;
  vouchersSoldYesterday: number;
  revenueLastWeek: number;
  vouchersSoldLastWeek: number;
  revenueCurrentMonth: number;
  vouchersSoldCurrentMonth: number;
  revenueTotal: number;
  vouchersSoldTotal: number;
  lastSaleAt?: string | null;
};

export default function DistributorsDaily() {
  const { data: report, isLoading } = useGetDistributorsDailyReport({
    query: { queryKey: getGetDistributorsDailyReportQueryKey() }
  });

  const sortedReport: ReportItem[] = report
    ? ([...report] as ReportItem[]).sort((a, b) => b.revenueToday - a.revenueToday)
    : [];

  const totalRevenueToday = sortedReport.reduce((sum, d) => sum + d.revenueToday, 0);
  const totalVouchersToday = sortedReport.reduce((sum, d) => sum + d.vouchersSoldToday, 0);
  const totalRevenueMonth = sortedReport.reduce((sum, d) => sum + d.revenueCurrentMonth, 0);

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Rapport Journalier</h1>
          <p className="text-muted-foreground mt-1">
            Performances des distributeurs par période.
          </p>
        </div>
        <div className="flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full font-medium text-sm">
          <CalendarDays className="h-4 w-4" />
          {new Date().toLocaleDateString("fr-FR", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="bg-primary text-primary-foreground">
            <CardHeader className="pb-2">
              <CardTitle className="text-primary-foreground/80 text-sm font-medium flex items-center gap-2">
                <Wallet className="h-4 w-4" /> Revenu Aujourd'hui
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{formatCurrency(totalRevenueToday)}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground text-sm font-medium flex items-center gap-2">
                <Ticket className="h-4 w-4" /> Vouchers Aujourd'hui
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{totalVouchersToday}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground text-sm font-medium flex items-center gap-2">
                <CalendarDays className="h-4 w-4" /> Revenu Mois en cours
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{formatCurrency(totalRevenueMonth)}</div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="space-y-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" /> Classement des Distributeurs
        </h2>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : sortedReport.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Aucune donnée disponible.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {sortedReport.map((dist, index) => (
              <Card key={dist.distributorId} className="overflow-hidden">
                <div className="bg-muted/40 px-4 py-3 border-b flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`flex items-center justify-center h-7 w-7 rounded-full font-bold text-xs flex-shrink-0 ${index === 0 ? "bg-yellow-400/30 text-yellow-700" : index === 1 ? "bg-slate-300/50 text-slate-600" : index === 2 ? "bg-amber-600/20 text-amber-700" : "bg-primary/10 text-primary"}`}>
                      #{index + 1}
                    </div>
                    <div>
                      <p className="font-semibold leading-tight">{dist.distributorName}</p>
                      {dist.phone && <p className="text-xs text-muted-foreground">{dist.phone}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={dist.status === "active" ? "default" : "secondary"}
                      className={dist.status === "active" ? "bg-green-500 hover:bg-green-600 text-xs" : "text-xs"}
                    >
                      {dist.status === "active" ? "Actif" : "Inactif"}
                    </Badge>
                    {dist.lastSaleAt && (
                      <span className="text-xs text-muted-foreground hidden sm:inline">
                        Dernière vente : {new Date(dist.lastSaleAt).toLocaleString("fr-FR")}
                      </span>
                    )}
                  </div>
                </div>

                <CardContent className="p-0">
                  <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0">
                    {periods.map((p) => (
                      <div key={p.key} className={`p-4 ${p.accent ? "bg-primary/5" : ""}`}>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{p.label}</p>
                        <p className={`text-xl font-bold ${p.accent ? "text-primary" : ""}`}>
                          {formatCurrency((dist as any)[p.revKey])}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {(dist as any)[p.qtyKey]} voucher{(dist as any)[p.qtyKey] !== 1 ? "s" : ""}
                        </p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
