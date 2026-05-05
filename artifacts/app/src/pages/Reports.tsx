import { useState, useMemo, useEffect } from "react";
import {
  useGetVendorReportsSummary,
  useGetVendorReport,
  useSyncVoucherUsage,
  getGetVendorReportQueryKey,
  getGetVendorReportsSummaryQueryKey,
} from "@workspace/api-client-react";
import type { VendorSummary } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  BarChart3, Users, Ticket,
  ArrowLeft, CalendarDays, CalendarClock, TrendingUp,
  RefreshCw, CheckCircle2, ArrowDownUp, XCircle, Printer,
} from "lucide-react";
import { printReport } from "@/lib/print";

/* ─── 2-segment bar: vendu (green) | non vendu (gray) ─────────── */
function SaleBar({ used, total }: { used: number; total: number }) {
  const usedPct    = total > 0 ? Math.round((used / total) * 100) : 0;
  const nonSoldPct = 100 - usedPct;
  const nonSold    = total - used;

  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-red-600 font-medium">{used} vendu{used !== 1 ? "s" : ""}</span>
        <span className="text-green-600">{nonSold} non vendu{nonSold !== 1 ? "s" : ""}</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden flex">
        <div
          className="h-full bg-red-500 transition-all rounded-l-full"
          style={{ width: `${usedPct}%` }}
          title={`${usedPct}% vendus`}
        />
        <div
          className="h-full bg-green-400 transition-all rounded-r-full"
          style={{ width: `${nonSoldPct}%` }}
          title={`${nonSoldPct}% non vendus`}
        />
      </div>
      <div className="flex gap-3 mt-1">
        <span className="flex items-center gap-1 text-xs text-gray-400">
          <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
          Vendu {usedPct}%
        </span>
        <span className="flex items-center gap-1 text-xs text-gray-400">
          <span className="inline-block w-2 h-2 rounded-full bg-green-400" />
          Non vendu {nonSoldPct}%
        </span>
      </div>
    </div>
  );
}

function fmtFcfa(n: number): string {
  if (n === 0) return "0";
  return n.toLocaleString("fr-FR");
}

function amountFontClass(formatted: string): string {
  const len = formatted.replace(/\s/g, "").length;
  if (len <= 5)  return "text-base";
  if (len <= 7)  return "text-sm";
  if (len <= 9)  return "text-xs";
  return "text-[10px]";
}

function SalesMiniCard({ label, amount, count, icon: Icon, color }: {
  label: string; amount: number; count: number; icon: React.ElementType; color: string;
}) {
  const formatted = fmtFcfa(amount);
  return (
    <div className={`flex flex-col items-center justify-center rounded-lg p-3 gap-0.5 ${color}`}>
      <Icon className="h-4 w-4 opacity-60" />
      <span className={`${amountFontClass(formatted)} fit-price font-bold leading-none mt-0.5`}>{formatted}</span>
      <span className="fit-text text-[10px] font-semibold opacity-50 leading-none">FCFA</span>
      <span className="text-[10px] opacity-60">{count} ticket{count !== 1 ? "s" : ""} vendu{count !== 1 ? "s" : ""}</span>
      <span className="text-xs text-center leading-tight opacity-80 font-medium mt-0.5">{label}</span>
    </div>
  );
}

/* ─── sync button ─────────────────────────────────────────────── */
function SyncButton({ routerId }: { routerId: number | null }) {
  const { mutate, isPending, data, isSuccess } = useSyncVoucherUsage();
  if (!routerId) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-2"
      disabled={isPending}
      onClick={() => mutate({ id: routerId })}
    >
      {isPending
        ? <RefreshCw className="h-4 w-4 animate-spin" />
        : isSuccess
          ? <CheckCircle2 className="h-4 w-4 text-green-500" />
          : <RefreshCw className="h-4 w-4" />}
      {isPending ? "Synchro…" : isSuccess ? `${data?.updated ?? 0} mis à jour` : "Sync usage"}
    </Button>
  );
}

/* ─── detail view ─────────────────────────────────────────────── */
function VendorDetailReport({ vendorId, onBack }: { vendorId: number; onBack: () => void }) {
  const { data, isLoading } = useGetVendorReport(vendorId, { query: { queryKey: getGetVendorReportQueryKey(vendorId), refetchInterval: 5_000 } });

  if (isLoading || !data) {
    return (
      <Card>
        <CardContent className="py-6 space-y-3">
          <Skeleton className="h-5 w-48 mx-auto" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  const nonSold   = data.totalVouchers - data.totalUsed;
  const ss        = data.salesStats;
  const todaySold = ss.todaySold;
  const totalJour = nonSold + todaySold;

  const detailPrintTitle = `${data.vendor.name} — Rapport de vente détaillé`;

  return (
    <div>
      <header className="no-print mb-6 flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={onBack} className="gap-2 flex-shrink-0">
          <ArrowLeft className="h-4 w-4" /> Retour
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-gray-900 truncate">{data.vendor.name}</h1>
        </div>
        <Button variant="outline" size="sm" onClick={() => printReport(detailPrintTitle)} className="gap-2 flex-shrink-0">
          <Printer className="h-4 w-4" /> Imprimer
        </Button>
        <Badge variant={data.vendor.isActive ? "default" : "secondary"} className="flex-shrink-0">
          {data.vendor.isActive ? "Actif" : "Inactif"}
        </Badge>
      </header>

      <main id="report-print-section" className="block">
        <div className="no-print">
      {/* Totaux — 3 cartes */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-5">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                <Ticket className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Total jour</p>
                <p className="text-xl font-bold text-gray-900">{totalJour}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="h-4 w-4 text-red-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Vendus auj.</p>
                <p className="text-xl font-bold text-red-600">{todaySold}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0">
                <XCircle className="h-4 w-4 text-green-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Non vendus</p>
                <p className="text-xl font-bold text-green-600">{nonSold}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Barre 2 segments */}
      <Card className="mb-5">
        <CardContent className="pt-5">
          <SaleBar used={todaySold} total={totalJour} />
        </CardContent>
      </Card>

      {/* Performance temporelle */}
      <Card className="mb-5">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-blue-500" />
            Performance de vente
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <SalesMiniCard label="Aujourd'hui"     amount={ss.todayAmount}     count={ss.todaySold}      icon={CalendarDays}  color="bg-green-50 text-green-700" />
            <SalesMiniCard label="Hier"             amount={ss.yesterdayAmount} count={ss.yesterdaySold}  icon={CalendarDays}  color="bg-amber-50 text-amber-700" />
            <SalesMiniCard label="Cette semaine"   amount={ss.weekAmount}      count={ss.weekSold}       icon={CalendarClock} color="bg-blue-50 text-blue-700" />
            <SalesMiniCard label="Semaine dernière" amount={ss.lastWeekAmount}  count={ss.lastWeekSold}   icon={CalendarClock} color="bg-indigo-50 text-indigo-700" />
            <SalesMiniCard label="Mois en cours"   amount={ss.thisMonthAmount} count={ss.thisMonthSold}  icon={TrendingUp}    color="bg-teal-50 text-teal-700" />
            <SalesMiniCard label="Mois dernier"    amount={ss.lastMonthAmount} count={ss.lastMonthSold}  icon={BarChart3}     color="bg-purple-50 text-purple-700" />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="flex flex-col h-96">
          <CardHeader className="pb-2 flex-none">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Par forfait</CardTitle>
              <span className="text-[10px] font-semibold text-blue-500 bg-blue-50 px-2 py-0.5 rounded-full">Semaine en cours</span>
            </div>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 overflow-y-auto">
            {data.byProfile.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">Aucun voucher généré</p>
            ) : (
              <div className="space-y-4">
                {[...data.byProfile].sort((a, b) => {
                  const wa = Number((a as any).weekSold ?? 0);
                  const wb = Number((b as any).weekSold ?? 0);
                  if (wb !== wa) return wb - wa;
                  const pa = parseFloat(String((a as any).price ?? "0").replace(/\s/g, "")) || 0;
                  const pb = parseFloat(String((b as any).price ?? "0").replace(/\s/g, "")) || 0;
                  return pa - pb;
                }).map((stat) => {
                  const weekSold = Number((stat as any).weekSold ?? 0);
                  const totalUsed = Number((stat as any).used ?? 0);
                  const nonSold  = stat.total - totalUsed;
                  const gaugeTotal = weekSold + nonSold;
                  return (
                    <div key={stat.profileName}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm font-medium">{stat.profileName}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-blue-600 font-semibold tabular-nums">{weekSold} cette semaine</span>
                        </div>
                      </div>
                      <SaleBar used={weekSold} total={gaugeTotal} />
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="flex flex-col h-96">
          <CardHeader className="pb-2 flex-none">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Dernières ventes</CardTitle>
              {data.recentVouchers.length > 0 && (
                <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full tabular-nums">
                  {data.recentVouchers.length}
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 p-0">
            {data.recentVouchers.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8 px-4">Aucune vente enregistrée</p>
            ) : (
              <div className="h-full overflow-x-auto overflow-y-auto">
                <table className="w-full min-w-[620px] text-xs border-collapse">
                  <thead>
                    <tr className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-3 py-2 font-semibold text-gray-500 uppercase tracking-wide text-[10px]">User</th>
                      <th className="text-right px-3 py-2 font-semibold text-gray-500 uppercase tracking-wide text-[10px]">Prix</th>
                      <th className="text-left px-3 py-2 font-semibold text-gray-500 uppercase tracking-wide text-[10px] hidden sm:table-cell">MAC</th>
                      <th className="text-left px-3 py-2 font-semibold text-gray-500 uppercase tracking-wide text-[10px] hidden md:table-cell">IP</th>
                      <th className="text-left px-3 py-2 font-semibold text-gray-500 uppercase tracking-wide text-[10px]">Date</th>
                      <th className="text-center px-3 py-2 font-semibold text-gray-500 uppercase tracking-wide text-[10px]">État</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentVouchers.map((v, i) => {
                      const displayPrice = (v as any).salePrice || (v as any).price || "";
                      const mac   = (v as any).macAddress || "";
                      const ip    = (v as any).saleIp     || "";
                      const soldAt = (() => {
                        if (!(v as any).usedAt) return null;
                        const d = new Date((v as any).usedAt);
                        const day = String(d.getDate()).padStart(2, "0");
                        const month = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"][d.getMonth()];
                        const hh = String(d.getHours()).padStart(2, "0");
                        const mn = String(d.getMinutes()).padStart(2, "0");
                        const ss = String(d.getSeconds()).padStart(2, "0");
                        return { date: `${day} ${month} ${d.getFullYear()}`, time: `${hh}:${mn}:${ss}` };
                      })();
                      return (
                        <tr key={v.id} className={`transition-colors hover:bg-gray-50 ${i % 2 === 0 ? "" : "bg-gray-50/50"}`}>
                          {/* User */}
                          <td className="px-3 py-2 max-w-[110px]">
                            <p className="font-mono font-semibold text-gray-800 truncate">{v.username}</p>
                            <p className="text-[10px] text-gray-400 truncate">{v.profileName}</p>
                          </td>
                          {/* Prix */}
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            {displayPrice
                              ? <span className="font-semibold text-green-700 tabular-nums">{Number(displayPrice).toLocaleString("fr-FR")} <span className="text-[10px] font-normal text-gray-400">FCFA</span></span>
                              : <span className="text-gray-300">—</span>
                            }
                          </td>
                          {/* MAC */}
                          <td className="px-3 py-2 hidden sm:table-cell">
                            <span className="font-mono text-gray-500 text-[10px]">{mac || "—"}</span>
                          </td>
                          {/* IP */}
                          <td className="px-3 py-2 hidden md:table-cell">
                            <span className="font-mono text-gray-500">{ip || "—"}</span>
                          </td>
                          {/* Date + Heure */}
                          <td className="px-3 py-2 whitespace-nowrap">
                            {soldAt
                              ? <>
                                  <p className="text-gray-700">{soldAt.date}</p>
                                  <p className="text-[10px] text-gray-400 font-mono">{soldAt.time}</p>
                                </>
                              : <span className="text-gray-300">—</span>
                            }
                          </td>
                          {/* État */}
                          <td className="px-3 py-2 text-center">
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-50 text-red-700 border border-red-200">
                              Vendu
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
        </div>

        <div className="print-only">
          <p className="report-print-title">{detailPrintTitle}</p>
          <p className="report-print-meta">
            Imprimé le {new Date().toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
          </p>
          <p className="report-print-section-label">Synthèse jour</p>
          <table className="report-print-table">
            <tbody>
              <tr>
                <td>Total jour</td>
                <td>{totalJour}</td>
              </tr>
              <tr>
                <td>Vendus aujourd&apos;hui</td>
                <td>{todaySold}</td>
              </tr>
              <tr>
                <td>Non vendus</td>
                <td>{nonSold}</td>
              </tr>
            </tbody>
          </table>
          <p className="report-print-section-label">Performance</p>
          <table className="report-print-table">
            <thead>
              <tr>
                <th>Période</th>
                <th>Montant FCFA</th>
                <th>Tickets</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>Aujourd&apos;hui</td><td>{fmtFcfa(ss.todayAmount)}</td><td>{ss.todaySold}</td></tr>
              <tr><td>Hier</td><td>{fmtFcfa(ss.yesterdayAmount)}</td><td>{ss.yesterdaySold}</td></tr>
              <tr><td>Cette semaine</td><td>{fmtFcfa(ss.weekAmount)}</td><td>{ss.weekSold}</td></tr>
              <tr><td>Semaine dernière</td><td>{fmtFcfa(ss.lastWeekAmount)}</td><td>{ss.lastWeekSold}</td></tr>
              <tr><td>Mois en cours</td><td>{fmtFcfa(ss.thisMonthAmount)}</td><td>{ss.thisMonthSold}</td></tr>
              <tr><td>Mois dernier</td><td>{fmtFcfa(ss.lastMonthAmount)}</td><td>{ss.lastMonthSold}</td></tr>
            </tbody>
          </table>
          {(() => {
            const rows = [...data.byProfile].sort((a, b) => {
              const wa = Number((a as { weekSold?: number }).weekSold ?? 0);
              const wb = Number((b as { weekSold?: number }).weekSold ?? 0);
              if (wb !== wa) return wb - wa;
              const pa = parseFloat(String((a as { price?: string }).price ?? "0").replace(/\s/g, "")) || 0;
              const pb = parseFloat(String((b as { price?: string }).price ?? "0").replace(/\s/g, "")) || 0;
              return pa - pb;
            });
            if (rows.length === 0) return null;
            return (
              <>
                <p className="report-print-section-label">Par forfait (semaine en cours)</p>
                <table className="report-print-table">
                  <thead>
                    <tr>
                      <th>Forfait</th>
                      <th>Vendus (semaine)</th>
                      <th>Non vendus</th>
                      <th>Stock (total)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((stat) => {
                      const weekSold = Number((stat as { weekSold?: number }).weekSold ?? 0);
                      const totalUsed = Number((stat as { used?: number }).used ?? 0);
                      const nonSold = stat.total - totalUsed;
                      return (
                        <tr key={stat.profileName}>
                          <td>{stat.profileName}</td>
                          <td>{weekSold}</td>
                          <td>{nonSold}</td>
                          <td>{stat.total}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            );
          })()}
          <p className="report-print-section-label">Dernières ventes ({data.recentVouchers.length})</p>
          <table className="report-print-table">
            <thead>
              <tr>
                <th>Utilisateur</th>
                <th>Prix (FCFA)</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {data.recentVouchers.map((v) => {
                const displayPrice = (v as { salePrice?: string | null; price?: string }).salePrice || (v as { price?: string }).price || "";
                const soldAt = v.usedAt ? new Date(v.usedAt).toLocaleString("fr-FR") : "—";
                return (
                  <tr key={v.id}>
                    <td style={{ fontFamily: "monospace", fontSize: "11px" }}>{v.username}</td>
                    <td>{displayPrice ? Number(displayPrice).toLocaleString("fr-FR") : "—"}</td>
                    <td>{soldAt}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}

/* ─── vendor card ─────────────────────────────────────────────── */
function VendorCard({ summary, onClick }: { summary: VendorSummary; onClick: () => void }) {
  const nonSold   = summary.totalVouchers - summary.totalUsed;
  const ss        = summary.salesStats;
  const todaySold = ss.todaySold;
  const total     = nonSold + todaySold;

  return (
    <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={onClick}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
              <Users className="h-5 w-5 text-blue-600" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-base truncate">{summary.vendor.name}</CardTitle>
              {summary.vendor.phone && <p className="text-xs text-gray-500 truncate">{summary.vendor.phone}</p>}
            </div>
          </div>
          <Badge variant={summary.vendor.isActive ? "default" : "secondary"} className="flex-shrink-0">
            {summary.vendor.isActive ? "Actif" : "Inactif"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {/* Compteurs */}
        <div className="grid grid-cols-3 gap-2 text-center mb-3">
          <div>
            <p className="text-lg font-bold text-gray-900">{total}</p>
            <p className="text-xs text-gray-500">Total jour</p>
          </div>
          <div>
            <p className="text-lg font-bold text-red-600">{todaySold}</p>
            <p className="text-xs text-red-600">Vendus auj.</p>
          </div>
          <div>
            <p className="text-lg font-bold text-green-600">{nonSold}</p>
            <p className="text-xs text-green-600">Non vendus</p>
          </div>
        </div>

        {/* Barre 2 segments */}
        <SaleBar used={todaySold} total={total} />

        {/* Stats temporelles */}
        <div className="mt-3 pt-3 border-t border-gray-100">
          <div className="grid grid-cols-2 gap-1.5">
            <SalesMiniCard label="Aujourd'hui"     amount={ss.todayAmount}     count={ss.todaySold}      icon={CalendarDays}  color="bg-green-50 text-green-700" />
            <SalesMiniCard label="Hier"             amount={ss.yesterdayAmount} count={ss.yesterdaySold}  icon={CalendarDays}  color="bg-amber-50 text-amber-700" />
            <SalesMiniCard label="Cette semaine"   amount={ss.weekAmount}      count={ss.weekSold}       icon={CalendarClock} color="bg-blue-50 text-blue-700" />
            <SalesMiniCard label="Semaine dernière" amount={ss.lastWeekAmount}  count={ss.lastWeekSold}   icon={CalendarClock} color="bg-indigo-50 text-indigo-700" />
            <SalesMiniCard label="Mois en cours"   amount={ss.thisMonthAmount} count={ss.thisMonthSold}  icon={TrendingUp}    color="bg-teal-50 text-teal-700" />
            <SalesMiniCard label="Mois dernier"    amount={ss.lastMonthAmount} count={ss.lastMonthSold}  icon={BarChart3}     color="bg-purple-50 text-purple-700" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── sort ────────────────────────────────────────────────────── */
type SortMode = "vendu-desc" | "vendu-asc" | "non-vendu" | "nom";

function sortSummaries(summaries: VendorSummary[], mode: SortMode): VendorSummary[] {
  const copy = [...summaries];
  switch (mode) {
    case "vendu-desc":
      return copy.sort((a, b) => b.totalUsed - a.totalUsed);
    case "vendu-asc":
      return copy.sort((a, b) => a.totalUsed - b.totalUsed);
    case "non-vendu":
      return copy.sort((a, b) => (b.totalVouchers - b.totalUsed) - (a.totalVouchers - a.totalUsed));
    case "nom":
      return copy.sort((a, b) => a.vendor.name.localeCompare(b.vendor.name, "fr"));
  }
}

/* ─── main page ───────────────────────────────────────────────── */
export default function Reports() {
  const { data: summaries = [], isLoading } = useGetVendorReportsSummary({ query: { queryKey: getGetVendorReportsSummaryQueryKey(), refetchInterval: 5_000 } });
  const [selectedVendorId, setSelectedVendorId] = useState<number | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("vendu-desc");

  useEffect(() => {
    const stored = sessionStorage.getItem("vouchernet_report_vendor_id");
    if (stored) {
      sessionStorage.removeItem("vouchernet_report_vendor_id");
      setSelectedVendorId(parseInt(stored, 10));
    }
  }, []);

  const routerId = (() => {
    try { const v = localStorage.getItem("vouchernet_router_id"); return v ? parseInt(v) : null; } catch { return null; }
  })();

  // Filter to only vendors of the active router
  const filtered = useMemo(
    () => routerId ? summaries.filter((s) => s.vendor.routerId === routerId) : summaries,
    [summaries, routerId],
  );

  const sorted = useMemo(() => sortSummaries(filtered, sortMode), [filtered, sortMode]);

  if (selectedVendorId) {
    return <VendorDetailReport vendorId={selectedVendorId} onBack={() => setSelectedVendorId(null)} />;
  }

  const totalNonSold   = filtered.reduce((s, r) => s + (r.totalVouchers - r.totalUsed), 0);
  const totalTodaySold = filtered.reduce((s, r) => s + r.salesStats.todaySold, 0);
  const totalJour      = totalNonSold + totalTodaySold;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Rapports de vente</h1>
        </div>
        <SyncButton routerId={routerId} />
      </div>

      {totalJour > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center gap-2">
                <div className="h-9 w-9 rounded-lg bg-blue-100 flex items-center justify-center">
                  <Ticket className="h-4 w-4 text-blue-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Total jour</p>
                  <p className="text-xl font-bold">{totalJour}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center gap-2">
                <div className="h-9 w-9 rounded-lg bg-red-100 flex items-center justify-center">
                  <CheckCircle2 className="h-4 w-4 text-red-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Vendus auj.</p>
                  <p className="text-xl font-bold text-red-600">{totalTodaySold}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center gap-2">
                <div className="h-9 w-9 rounded-lg bg-green-100 flex items-center justify-center">
                  <XCircle className="h-4 w-4 text-green-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Non vendus</p>
                  <p className="text-xl font-bold text-green-600">{totalNonSold}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {isLoading ? (
        <Card>
          <CardContent className="py-6 space-y-3">
            <Skeleton className="h-5 w-44 mx-auto" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <BarChart3 className="h-12 w-12 text-gray-300 mb-4" />
            <p className="text-gray-500 font-medium">Aucun rapport disponible</p>
            <p className="text-sm text-gray-400 mt-1">Ajoutez des vendeurs et générez des vouchers pour voir les rapports</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <p className="text-sm text-gray-500">{filtered.length} vendeur(s)</p>
            <div className="flex items-center gap-2">
              <ArrowDownUp className="h-3.5 w-3.5 text-gray-400" />
              <Select value={sortMode} onValueChange={(v) => setSortMode(v as SortMode)}>
                <SelectTrigger className="w-48 h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vendu-desc">Meilleure performance</SelectItem>
                  <SelectItem value="non-vendu">Performance faible</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sorted.map((summary) => (
              <VendorCard
                key={summary.vendor.id}
                summary={summary}
                onClick={() => setSelectedVendorId(summary.vendor.id)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
