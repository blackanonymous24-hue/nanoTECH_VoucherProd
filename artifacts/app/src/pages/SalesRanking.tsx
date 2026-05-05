import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePageVisibility } from "@/hooks/use-page-visibility";
import { Link } from "wouter";
import { Trophy, Medal, Users, ArrowLeft, RefreshCw, ShoppingCart, Banknote, ChevronLeft, Printer } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useRouterContext } from "@/contexts/RouterContext";
import { printReport } from "@/lib/print";
const LIVE_SALES_POLL_MS = 10_000;

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const MONTHS = [
  "Janvier","Février","Mars","Avril","Mai","Juin",
  "Juillet","Août","Septembre","Octobre","Novembre","Décembre",
];

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

interface Voucher {
  id: number;
  username: string;
  password: string;
  profileName: string;
  price: string;
  salePrice: string | null;
  saleIp: string | null;
  macAddress: string | null;
  printedAt: string | null;
  usedAt: string | null;
  createdAt: string;
}

interface PeriodSalesData {
  vendorName: string;
  period: string;
  label: string;
  total: number;
  revenue: number;
  byProfile: { profileName: string; count: number; revenue: number; price?: string }[];
  vouchers: Voucher[];
}

function getRankStyle(rank: number) {
  if (rank === 1) return { bg: "bg-yellow-50 border-yellow-300", badge: "bg-yellow-400 text-white", icon: <Trophy className="h-4 w-4" /> };
  if (rank === 2) return { bg: "bg-gray-50 border-gray-300", badge: "bg-gray-400 text-white", icon: <Medal className="h-4 w-4" /> };
  if (rank === 3) return { bg: "bg-orange-50 border-orange-200", badge: "bg-orange-400 text-white", icon: <Medal className="h-4 w-4" /> };
  return { bg: "bg-white border-gray-100", badge: "bg-gray-100 text-gray-600", icon: null };
}

/* ── Rapport période d'un vendeur (vue admin) ─────────────────── */
function VendorPeriodReport({ vendorId, vendorName, period, onBack }: {
  vendorId: number;
  vendorName: string;
  period: "today" | "month";
  onBack: () => void;
}) {
  const isVisible = usePageVisibility();
  const { data, isLoading, error } = useQuery<PeriodSalesData>({
    queryKey: ["vendor-period-sales", vendorId, period],
    queryFn: async ({ signal }) => {
      const res = await fetch(`${BASE}/api/vendors/${vendorId}/period-sales?period=${period}`, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 8_000,
    refetchInterval: isVisible ? LIVE_SALES_POLL_MS : false,
    refetchIntervalInBackground: false,
    placeholderData: (previousData) => previousData,
  });

  const today = new Date().toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  const monthLabel = new Date().toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const subtitle = period === "today" ? today : monthLabel;
  const soldLabel = period === "today" ? "Vendus aujourd'hui" : "Vendus ce mois";
  const emptyLabel = period === "today" ? "Aucune vente aujourd'hui" : "Aucune vente ce mois";
  const printTitle = period === "today" ? "Rapport de ventes du jour" : "Rapport de ventes du mois";

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 no-print">
        <Button size="sm" variant="ghost" onClick={onBack} className="gap-1.5">
          <ChevronLeft className="h-4 w-4" /> Retour
        </Button>
        <div className="h-5 w-px bg-gray-200" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{data?.vendorName ?? vendorName}</p>
          <p className="text-xs text-gray-500 capitalize">{subtitle}</p>
        </div>
        {data && data.total > 0 && (
          <Button size="sm" variant="outline" onClick={() => printReport(printTitle)} className="gap-1.5">
            <Printer className="h-4 w-4" /> Imprimer
          </Button>
        )}
      </header>

      <main id="report-print-section" className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {isLoading && (
          <Card>
            <CardContent className="py-6 space-y-3">
              <Skeleton className="h-5 w-44 mx-auto" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </CardContent>
          </Card>
        )}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
            Impossible de charger le rapport
          </div>
        )}

        {data && (
          <>
            {/* ── Écran ── */}
            <div className="no-print space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Card className="h-full">
                  <CardContent className="p-4 h-full flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-blue-500 flex items-center justify-center flex-shrink-0">
                      <ShoppingCart className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-gray-900">{data.total}</p>
                      <p className="text-xs text-gray-500">{soldLabel}</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="h-full">
                  <CardContent className="p-4 h-full flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-green-500 flex items-center justify-center flex-shrink-0">
                      <Banknote className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <p className="fit-price font-bold text-gray-900">{data.revenue.toLocaleString("fr-FR")}</p>
                      <p className="text-xs text-gray-500">FCFA estimé</p>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {data.byProfile.length > 0 && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-base">Par forfait</CardTitle></CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {[...data.byProfile]
                        .sort((a, b) => (parseFloat(String(a.price ?? "0").replace(/\s/g, "")) || 0) - (parseFloat(String(b.price ?? "0").replace(/\s/g, "")) || 0))
                        .map((p) => (
                          <div key={p.profileName} className="flex items-center justify-between py-2 border-b last:border-0">
                            <span className="text-sm font-medium text-gray-700">{p.profileName}</span>
                            <div className="flex items-center gap-4 text-sm">
                              <span className="text-gray-500">{p.count} ticket{Number(p.count) > 1 ? "s" : ""}</span>
                              {Number(p.revenue) > 0 && (
                                <span className="font-semibold text-gray-800">{Number(p.revenue).toLocaleString("fr-FR")} FCFA</span>
                              )}
                            </div>
                          </div>
                        ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Tickets vendus ({data.total})</CardTitle>
                    {data.vouchers.length > 0 && (
                      <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full tabular-nums">
                        {data.vouchers.length}
                      </span>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {data.vouchers.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-6 px-4">{emptyLabel}</p>
                  ) : (
                    <div className="max-h-80 overflow-x-auto overflow-y-auto scroll-card">
                      <table className="w-full min-w-[520px] text-xs border-collapse">
                        <thead>
                          <tr className="sticky top-0 z-10 bg-gray-50 backdrop-blur-sm border-b border-gray-200">
                            <th className="text-left px-3 py-2 font-semibold text-gray-500 uppercase tracking-wide text-[10px]">User</th>
                            <th className="text-right px-3 py-2 font-semibold text-gray-500 uppercase tracking-wide text-[10px]">Prix</th>
                            <th className="text-left px-3 py-2 font-semibold text-gray-500 uppercase tracking-wide text-[10px] hidden sm:table-cell">MAC</th>
                            <th className="text-left px-3 py-2 font-semibold text-gray-500 uppercase tracking-wide text-[10px]">Date</th>
                            <th className="text-center px-3 py-2 font-semibold text-gray-500 uppercase tracking-wide text-[10px]">État</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.vouchers.map((v, i) => {
                            const displayPrice = v.salePrice || v.price || "";
                            const dateStr = (() => {
                              const raw = v.usedAt || v.printedAt;
                              if (!raw) return null;
                              const d = new Date(raw);
                              const dy = String(d.getDate()).padStart(2, "0");
                              const hh = String(d.getHours()).padStart(2, "0");
                              const mn = String(d.getMinutes()).padStart(2, "0");
                              const ss = String(d.getSeconds()).padStart(2, "0");
                              return `${dy} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${hh}:${mn}:${ss}`;
                            })();
                            return (
                              <tr key={v.id} className={`transition-colors hover:bg-gray-50 ${i % 2 === 0 ? "" : "bg-gray-50/50"}`}>
                                <td className="px-3 py-2 max-w-[120px]">
                                  <p className="font-mono font-semibold text-gray-800 truncate">{v.username}</p>
                                  <p className="text-[10px] text-gray-400 truncate">{v.profileName}</p>
                                </td>
                                <td className="px-3 py-2 text-right whitespace-nowrap">
                                  {displayPrice ? (
                                    <span className="font-semibold text-emerald-600 tabular-nums">
                                      {Number(displayPrice).toLocaleString("fr-FR")}
                                      <span className="text-[9px] text-gray-400 ml-0.5">FCFA</span>
                                    </span>
                                  ) : <span className="text-gray-300">—</span>}
                                </td>
                                <td className="px-3 py-2 hidden sm:table-cell">
                                  <span className="font-mono text-[10px] text-gray-500">{v.macAddress || <span className="text-gray-300">—</span>}</span>
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap">
                                  <span className="text-gray-600">{dateStr ?? "—"}</span>
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-50 text-red-500 ring-1 ring-red-200 whitespace-nowrap">
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

            {/* ── Impression ── */}
            <div className="print-only">
              <p className="report-print-title">{data.vendorName ?? vendorName} — {printTitle}</p>
              <p className="report-print-meta">
                {subtitle.charAt(0).toUpperCase() + subtitle.slice(1)} &nbsp;·&nbsp; Imprimé le{" "}
                {new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
              </p>
              <p className="report-print-section-label">Résumé</p>
              <table className="report-print-table">
                <thead><tr><th>Total tickets vendus</th><th>Chiffre d'affaires estimé</th></tr></thead>
                <tbody>
                  <tr>
                    <td><strong>{data.total}</strong></td>
                    <td><strong>{data.revenue.toLocaleString("fr-FR")} FCFA</strong></td>
                  </tr>
                </tbody>
              </table>
              {data.byProfile.length > 0 && (
                <>
                  <p className="report-print-section-label">Par forfait</p>
                  <table className="report-print-table">
                    <thead><tr><th>Forfait</th><th>Tickets</th><th>Montant FCFA</th></tr></thead>
                    <tbody>
                      {data.byProfile.map((p) => (
                        <tr key={p.profileName}>
                          <td>{p.profileName}</td>
                          <td>{p.count}</td>
                          <td>{Number(p.revenue).toLocaleString("fr-FR")}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td>Total</td>
                        <td>{data.total}</td>
                        <td>{data.revenue.toLocaleString("fr-FR")}</td>
                      </tr>
                    </tfoot>
                  </table>
                </>
              )}
              <p className="report-print-section-label">Liste des tickets vendus ({data.total})</p>
              <table className="report-print-table">
                <thead><tr><th>#</th><th>Code</th><th>Forfait</th><th>Prix (FCFA)</th><th>Heure</th></tr></thead>
                <tbody>
                  {data.vouchers.map((v, i) => (
                    <tr key={v.id}>
                      <td>{i + 1}</td>
                      <td style={{ fontFamily: "monospace" }}>{v.username}</td>
                      <td>{v.profileName}</td>
                      <td>{v.price ?? "—"}</td>
                      <td>{v.usedAt ? new Date(v.usedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

/* ── Classement principal ────────────────────────────────────────── */
export default function SalesRanking({ period }: { period: "daily" | "monthly" }) {
  const { selectedRouterId } = useRouterContext();
  const isVisible = usePageVisibility();
  const [selectedVendor, setSelectedVendor] = useState<{ id: number; name: string } | null>(null);
  const queryClient = useQueryClient();

  // Retour au classement si on change de routeur pendant la vue détail vendeur
  useEffect(() => { setSelectedVendor(null); }, [selectedRouterId]);

  const isDaily = period === "daily";
  const title = isDaily ? "Ventes journalières" : "Ventes mensuelles";
  const subtitle = isDaily ? "Classement du jour" : "Classement du mois en cours";
  const otherPeriod = isDaily ? "monthly" : "daily";
  const otherLabel = isDaily ? "Voir mensuel" : "Voir journalier";

  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery<VendorSummary[]>({
    queryKey: ["vendors-summary", selectedRouterId],
    queryFn: async ({ signal }) => {
      const url = selectedRouterId
        ? `${BASE}/api/vendors/reports/summary?routerId=${selectedRouterId}`
        : `${BASE}/api/vendors/reports/summary`;
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<VendorSummary[]>;
    },
    refetchInterval: isVisible ? LIVE_SALES_POLL_MS : false,
    refetchIntervalInBackground: false,
    staleTime: 8_000,
  });

  /* Pre-fetch each vendor's period report as soon as the list is loaded,
     so clicking a vendor is instant instead of waiting for the API. */
  useEffect(() => {
    if (!data) return;
    const reportPeriod = isDaily ? "today" : "month";
    for (const entry of data) {
      const vendorId = entry.vendor.id;
      queryClient.prefetchQuery({
        queryKey: ["vendor-period-sales", vendorId, reportPeriod],
        queryFn: async ({ signal }) => {
          const res = await fetch(`${BASE}/api/vendors/${vendorId}/period-sales?period=${reportPeriod}`, { signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<PeriodSalesData>;
        },
        staleTime: 8_000,
      });
    }
  }, [data, isDaily, queryClient]);

  if (selectedVendor) {
    return (
      <VendorPeriodReport
        vendorId={selectedVendor.id}
        vendorName={selectedVendor.name}
        period={isDaily ? "today" : "month"}
        onBack={() => setSelectedVendor(null)}
      />
    );
  }

  const sorted = (data ?? [])
    .map((d) => ({ ...d, count: isDaily ? d.salesStats.todaySold : d.salesStats.thisMonthSold }))
    .sort((a, b) => b.count - a.count);

  const total = sorted.reduce((sum, d) => sum + d.count, 0);
  const updatedTime = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("fr-FR") : null;
  const rankingPrintTitle = "Rapport de ventes";

  return (
    <div className="max-w-2xl mx-auto px-6">
      <header className="no-print pt-6 pb-0">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/" className="text-gray-400 hover:text-gray-600 transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
            <p className="text-sm text-gray-500">{subtitle}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {sorted.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => printReport(rankingPrintTitle)} className="gap-1.5">
                <Printer className="h-4 w-4" /> Imprimer
              </Button>
            )}
            <Link
              href={`/sales/${otherPeriod}`}
              className="text-sm text-blue-600 hover:underline font-medium whitespace-nowrap"
            >
              {otherLabel}
            </Link>
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </header>

      <main id="report-print-section" className="pb-6">
        <div className="no-print">
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
                  <div
                    key={entry.vendor.id}
                    onClick={() => setSelectedVendor({ id: entry.vendor.id, name: entry.vendor.name })}
                    className={`border rounded-xl px-4 py-3 flex items-center gap-4 transition-shadow ${bg} cursor-pointer hover:shadow-sm`}
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
                );
              })}
            </div>
          )}

          {updatedTime && (
            <p className="text-xs text-gray-400 text-center mt-4">Mis à jour à {updatedTime}</p>
          )}
        </div>

        {sorted.length > 0 && (
          <div className="print-only">
            <p className="report-print-title">{rankingPrintTitle}</p>
            <p className="report-print-meta">
              {title} — {subtitle}
              {" "}
              &nbsp;·&nbsp; {sorted.length} vendeur{sorted.length !== 1 ? "s" : ""}
              {" "}
              &nbsp;·&nbsp; {total.toLocaleString("fr-FR")} tickets
              {" "}
              &nbsp;·&nbsp; Imprimé le{" "}
              {new Date().toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </p>
            <p className="report-print-section-label">Classement</p>
            <table className="report-print-table">
              <thead>
                <tr>
                  <th>Rang</th>
                  <th>Vendeur</th>
                  <th>Tickets vendus</th>
                  <th>Part</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((entry, idx) => {
                  const rank = idx + 1;
                  const pct = total > 0 ? Math.round((entry.count / total) * 100) : 0;
                  return (
                    <tr key={entry.vendor.id}>
                      <td>{rank}</td>
                      <td>{entry.vendor.name}</td>
                      <td>{entry.count.toLocaleString("fr-FR")}</td>
                      <td>{pct}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
