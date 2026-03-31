import {
  useGetDistributorsDailyReport,
  getGetDistributorsDailyReportQueryKey,
} from "@workspace/api-client-react";
import { formatCurrency } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrendingUp, Wallet, Ticket, CalendarDays, FileText, Printer } from "lucide-react";

const periods = [
  { key: "Today",        label: "Aujourd'hui",    revKey: "revenueToday",        qtyKey: "vouchersSoldToday",        accent: true },
  { key: "Yesterday",    label: "Hier",            revKey: "revenueYesterday",     qtyKey: "vouchersSoldYesterday",     accent: false },
  { key: "LastWeek",     label: "Semaine préc.",   revKey: "revenueLastWeek",      qtyKey: "vouchersSoldLastWeek",      accent: false },
  { key: "CurrentMonth", label: "Mois en cours",   revKey: "revenueCurrentMonth",  qtyKey: "vouchersSoldCurrentMonth",  accent: false },
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

// ── export helpers ────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat("fr-FR").format(n) + " FCFA";
}

function buildTxtReport(
  report: ReportItem[],
  periodLabel: string,
  revKey: keyof ReportItem,
  qtyKey: keyof ReportItem
): string {
  const today = new Date().toLocaleString("fr-FR");
  const separator = "=".repeat(60);
  const thin = "-".repeat(60);

  const lines: string[] = [
    separator,
    `   RAPPORT DES VENTES — ${periodLabel.toUpperCase()}`,
    `   Exporté le ${today}`,
    separator,
    "",
  ];

  const sorted = [...report].sort((a, b) => (b[revKey] as number) - (a[revKey] as number));
  const totalRev = sorted.reduce((s, d) => s + (d[revKey] as number), 0);
  const totalQty = sorted.reduce((s, d) => s + (d[qtyKey] as number), 0);

  lines.push(`TOTAL GLOBAL : ${fmt(totalRev)} — ${totalQty} voucher(s)`);
  lines.push(thin);
  lines.push("");

  sorted.forEach((d, i) => {
    const rev = d[revKey] as number;
    const qty = d[qtyKey] as number;
    lines.push(`#${i + 1}  ${d.distributorName}${d.phone ? "  |  " + d.phone : ""}`);
    lines.push(`    Ventes : ${fmt(rev)}  (${qty} voucher${qty !== 1 ? "s" : ""})`);
    if (d.lastSaleAt) {
      lines.push(`    Dernière vente : ${new Date(d.lastSaleAt).toLocaleString("fr-FR")}`);
    }
    lines.push(thin);
  });

  return lines.join("\n");
}

function downloadFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function printReport(
  report: ReportItem[],
  periodLabel: string,
  revKey: keyof ReportItem,
  qtyKey: keyof ReportItem
) {
  const today = new Date().toLocaleString("fr-FR");
  const sorted = [...report].sort((a, b) => (b[revKey] as number) - (a[revKey] as number));
  const totalRev = sorted.reduce((s, d) => s + (d[revKey] as number), 0);
  const totalQty = sorted.reduce((s, d) => s + (d[qtyKey] as number), 0);

  const rows = sorted
    .map(
      (d, i) => `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${d.distributorName}</strong>${d.phone ? `<br><small>${d.phone}</small>` : ""}</td>
        <td style="text-align:right"><strong>${fmt(d[revKey] as number)}</strong></td>
        <td style="text-align:center">${d[qtyKey] as number}</td>
        <td>${d.lastSaleAt ? new Date(d.lastSaleAt).toLocaleString("fr-FR") : "—"}</td>
      </tr>`
    )
    .join("");

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <title>Rapport — ${periodLabel}</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 15px; margin: 30px; color: #111; }
    h1 { font-size: 22px; margin-bottom: 4px; }
    .meta { color: #555; margin-bottom: 20px; font-size: 14px; }
    .total { background: #f0f4ff; padding: 12px 18px; border-radius: 6px; margin-bottom: 20px; font-size: 17px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #2563eb; color: white; padding: 10px 12px; text-align: left; font-size: 14px; }
    td { padding: 10px 12px; border-bottom: 1px solid #e5e7eb; vertical-align: top; font-size: 14px; }
    tr:nth-child(even) td { background: #f9fafb; }
    @media print { body { margin: 15px; } }
  </style>
</head>
<body>
  <h1>Rapport des ventes — ${periodLabel}</h1>
  <p class="meta">Exporté le ${today}</p>
  <div class="total">
    Total global : <strong>${fmt(totalRev)}</strong> — <strong>${totalQty}</strong> voucher(s)
  </div>
  <table>
    <thead>
      <tr>
        <th>#</th><th>Vendeur</th><th>Revenu</th><th>Vouchers</th><th>Dernière vente</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;

  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.onload = () => win.print();
}

// ── component ─────────────────────────────────────────────────────────────────

export default function DistributorsDaily() {
  const { data: report, isLoading } = useGetDistributorsDailyReport({
    query: { queryKey: getGetDistributorsDailyReportQueryKey() },
  });

  const sortedReport: ReportItem[] = report
    ? ([...report] as ReportItem[]).sort((a, b) => b.revenueToday - a.revenueToday)
    : [];

  const totalRevenueToday = sortedReport.reduce((sum, d) => sum + d.revenueToday, 0);
  const totalVouchersToday = sortedReport.reduce((sum, d) => sum + d.vouchersSoldToday, 0);
  const totalRevenueMonth = sortedReport.reduce((sum, d) => sum + d.revenueCurrentMonth, 0);

  const exportPeriod = (
    periodLabel: string,
    revKey: keyof ReportItem,
    qtyKey: keyof ReportItem,
    slug: string
  ) => ({
    txt: () => {
      const content = buildTxtReport(sortedReport, periodLabel, revKey, qtyKey);
      downloadFile(content, `rapport-${slug}-${new Date().toISOString().slice(0, 10)}.txt`, "text/plain");
    },
    pdf: () => printReport(sortedReport, periodLabel, revKey, qtyKey),
  });

  const yesterday = exportPeriod("Hier", "revenueYesterday", "vouchersSoldYesterday", "hier");
  const lastWeek = exportPeriod("Semaine précédente", "revenueLastWeek", "vouchersSoldLastWeek", "semaine-prec");

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Rapport Journalier</h1>
          <p className="text-muted-foreground mt-1">Performances des distributeurs par période.</p>
        </div>
        <div className="flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full font-medium text-sm">
          <CalendarDays className="h-4 w-4" />
          {new Date().toLocaleDateString("fr-FR", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
        </div>
      </div>

      {/* Export buttons */}
      {!isLoading && sortedReport.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-medium text-muted-foreground mb-3">Exporter le rapport</p>
            <div className="flex flex-wrap gap-3">
              <div className="flex items-center gap-1">
                <span className="text-sm font-medium mr-2">Hier :</span>
                <Button size="sm" variant="outline" className="gap-2" onClick={yesterday.txt}>
                  <FileText className="h-3.5 w-3.5" /> .txt
                </Button>
                <Button size="sm" variant="outline" className="gap-2" onClick={yesterday.pdf}>
                  <Printer className="h-3.5 w-3.5" /> PDF
                </Button>
              </div>
              <div className="w-px bg-border mx-1 hidden sm:block" />
              <div className="flex items-center gap-1">
                <span className="text-sm font-medium mr-2">Semaine préc. :</span>
                <Button size="sm" variant="outline" className="gap-2" onClick={lastWeek.txt}>
                  <FileText className="h-3.5 w-3.5" /> .txt
                </Button>
                <Button size="sm" variant="outline" className="gap-2" onClick={lastWeek.pdf}>
                  <Printer className="h-3.5 w-3.5" /> PDF
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary cards */}
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

      {/* Distributor ranking */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" /> Classement des Distributeurs
        </h2>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : sortedReport.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">Aucune donnée disponible.</CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {sortedReport.map((dist, index) => (
              <Card key={dist.distributorId} className="overflow-hidden">
                <div className="bg-muted/40 px-4 py-3 border-b flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex items-center justify-center h-7 w-7 rounded-full font-bold text-xs flex-shrink-0 ${
                        index === 0
                          ? "bg-yellow-400/30 text-yellow-700"
                          : index === 1
                          ? "bg-slate-300/50 text-slate-600"
                          : index === 2
                          ? "bg-amber-600/20 text-amber-700"
                          : "bg-primary/10 text-primary"
                      }`}
                    >
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
