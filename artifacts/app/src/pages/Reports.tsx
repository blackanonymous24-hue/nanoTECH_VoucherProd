import { useState, useMemo } from "react";
import {
  useGetVendorReportsSummary,
  useGetVendorReport,
  useSyncVoucherUsage,
} from "@workspace/api-client-react";
import type { VendorSummary } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  BarChart3, Users, Ticket, ShoppingCart, PackageOpen,
  ArrowLeft, CalendarDays, CalendarClock, TrendingUp,
  RefreshCw, CheckCircle2, ArrowDownUp,
} from "lucide-react";

/* ─── helpers ─────────────────────────────────────────────────── */

/** 3-segment bar: utilisé (green) | distribué (amber) | disponible (blue) */
function AvailabilityBar({
  used, distributed, total,
}: { used: number; distributed: number; total: number }) {
  const available    = total - distributed - used;
  const usedPct      = total > 0 ? Math.round((used         / total) * 100) : 0;
  const distPct      = total > 0 ? Math.round((distributed  / total) * 100) : 0;
  const availPct     = 100 - usedPct - distPct;

  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-green-600 font-medium">{used} utilisés</span>
        <span className="text-amber-600">{distributed} distribués</span>
        <span className="text-blue-400">{available} disponibles</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden flex">
        <div className="h-full bg-green-500 transition-all"  style={{ width: `${usedPct}%`  }} title={`${usedPct}% utilisés`} />
        <div className="h-full bg-amber-400 transition-all"  style={{ width: `${distPct}%`  }} title={`${distPct}% distribués`} />
        <div className="h-full bg-blue-200 transition-all"   style={{ width: `${availPct}%` }} title={`${availPct}% disponibles`} />
      </div>
      <div className="flex gap-3 mt-1">
        <span className="flex items-center gap-1 text-xs text-gray-400"><span className="inline-block w-2 h-2 rounded-full bg-green-500" />Utilisés {usedPct}%</span>
        <span className="flex items-center gap-1 text-xs text-gray-400"><span className="inline-block w-2 h-2 rounded-full bg-amber-400" />Distribués {distPct}%</span>
        <span className="flex items-center gap-1 text-xs text-gray-400"><span className="inline-block w-2 h-2 rounded-full bg-blue-200" />Disponibles {availPct}%</span>
      </div>
    </div>
  );
}

function SalesMiniCard({ label, value, icon: Icon, color }: {
  label: string; value: number; icon: React.ElementType; color: string;
}) {
  return (
    <div className={`flex flex-col items-center justify-center rounded-lg p-2 ${color}`}>
      <Icon className="h-4 w-4 mb-0.5 opacity-70" />
      <span className="text-lg font-bold leading-none">{value}</span>
      <span className="text-xs mt-0.5 text-center leading-tight opacity-80">{label}</span>
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
  const { data, isLoading } = useGetVendorReport(vendorId, { query: { refetchInterval: 10_000 } });

  if (isLoading || !data) return <div className="text-center py-12 text-gray-400">Chargement du rapport...</div>;

  const distributed = data.totalPrinted - data.totalUsed;
  const available   = data.totalVouchers - data.totalPrinted;
  const ss = data.salesStats;

  return (
    <div>
      <div className="mb-6 flex items-center gap-4">
        <Button variant="outline" size="sm" onClick={onBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Retour
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{data.vendor.name}</h1>
          <p className="text-sm text-gray-500">Rapport de vente détaillé</p>
        </div>
        <Badge variant={data.vendor.isActive ? "default" : "secondary"} className="ml-auto">
          {data.vendor.isActive ? "Actif" : "Inactif"}
        </Badge>
      </div>

      {/* Stock totaux — 4 cartes */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                <Ticket className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Total</p>
                <p className="text-xl font-bold text-gray-900">{data.totalVouchers}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Utilisés</p>
                <p className="text-xl font-bold text-green-600">{data.totalUsed}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
                <ShoppingCart className="h-4 w-4 text-amber-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Distribués</p>
                <p className="text-xl font-bold text-amber-600">{distributed}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                <PackageOpen className="h-4 w-4 text-blue-500" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Disponibles</p>
                <p className="text-xl font-bold text-blue-500">{available}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Performance temporelle */}
      <Card className="mb-5">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-blue-500" />
            Performance de vente
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-3">
            <SalesMiniCard label="Aujourd'hui" value={ss.todaySold}      icon={CalendarDays}  color="bg-green-50 text-green-700" />
            <SalesMiniCard label="Hier"         value={ss.yesterdaySold}  icon={CalendarDays}  color="bg-amber-50 text-amber-700" />
            <SalesMiniCard label="Cette semaine" value={ss.weekSold}      icon={CalendarClock} color="bg-blue-50 text-blue-700" />
            <SalesMiniCard label="Mois dernier"  value={ss.lastMonthSold} icon={BarChart3}      color="bg-purple-50 text-purple-700" />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Par forfait</CardTitle></CardHeader>
          <CardContent>
            {data.byProfile.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">Aucun voucher généré</p>
            ) : (
              <div className="space-y-4">
                {data.byProfile.map((stat) => {
                  const used  = Number((stat as any).used ?? 0);
                  const dist  = Number(stat.printed) - used;
                  return (
                    <div key={stat.profileName}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm font-medium">{stat.profileName}</span>
                        <span className="text-xs text-gray-400">{stat.total} total</span>
                      </div>
                      <AvailabilityBar used={used} distributed={dist} total={stat.total} />
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Derniers vouchers</CardTitle></CardHeader>
          <CardContent>
            {data.recentVouchers.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">Aucun voucher</p>
            ) : (
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {data.recentVouchers.map((v) => (
                  <div key={v.id} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                    <div>
                      <span className="text-sm font-mono font-medium">{v.username}</span>
                      <span className="text-xs text-gray-400 ml-2">/ {v.password}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">{v.profileName}</span>
                      {(v as any).usedAt ? (
                        <Badge className="text-xs bg-green-600">Utilisé</Badge>
                      ) : v.printedAt ? (
                        <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">Distribué</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs text-blue-500 border-blue-300">Disponible</Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ─── vendor card ─────────────────────────────────────────────── */
function VendorCard({ summary, onClick }: { summary: VendorSummary; onClick: () => void }) {
  const used         = summary.totalUsed;
  const distributed  = summary.totalPrinted - summary.totalUsed;
  const ss           = summary.salesStats;

  return (
    <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={onClick}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
              <Users className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <CardTitle className="text-base">{summary.vendor.name}</CardTitle>
              {summary.vendor.phone && <p className="text-xs text-gray-500">{summary.vendor.phone}</p>}
            </div>
          </div>
          <Badge variant={summary.vendor.isActive ? "default" : "secondary"}>
            {summary.vendor.isActive ? "Actif" : "Inactif"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {/* Stock */}
        <div className="grid grid-cols-4 gap-2 text-center mb-3">
          <div>
            <p className="text-lg font-bold text-gray-900">{summary.totalVouchers}</p>
            <p className="text-xs text-gray-500">Total</p>
          </div>
          <div>
            <p className="text-lg font-bold text-green-600">{used}</p>
            <p className="text-xs text-green-600">Utilisés</p>
          </div>
          <div>
            <p className="text-lg font-bold text-amber-600">{distributed}</p>
            <p className="text-xs text-amber-600">Distribués</p>
          </div>
          <div>
            <p className="text-lg font-bold text-blue-500">{summary.totalVouchers - summary.totalPrinted}</p>
            <p className="text-xs text-blue-500">Disponibles</p>
          </div>
        </div>

        {/* Barre 3 segments */}
        <AvailabilityBar used={used} distributed={distributed} total={summary.totalVouchers} />

        {/* Stats temporelles */}
        <div className="mt-3 pt-3 border-t border-gray-100">
          <div className="grid grid-cols-4 gap-1.5">
            <SalesMiniCard label="Auj."    value={ss.todaySold}      icon={CalendarDays}  color="bg-green-50 text-green-700" />
            <SalesMiniCard label="Hier"    value={ss.yesterdaySold}  icon={CalendarDays}  color="bg-amber-50 text-amber-700" />
            <SalesMiniCard label="Semaine" value={ss.weekSold}       icon={CalendarClock} color="bg-blue-50 text-blue-700" />
            <SalesMiniCard label="Mois-1"  value={ss.lastMonthSold}  icon={BarChart3}     color="bg-purple-50 text-purple-700" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

type SortMode = "vendu-desc" | "vendu-asc" | "non-vendu" | "nom";

function sortSummaries(summaries: VendorSummary[], mode: SortMode): VendorSummary[] {
  const copy = [...summaries];
  switch (mode) {
    case "vendu-desc":
      return copy.sort((a, b) => b.totalUsed - a.totalUsed);
    case "vendu-asc":
      return copy.sort((a, b) => a.totalUsed - b.totalUsed);
    case "non-vendu":
      return copy.sort((a, b) => {
        const aNonSold = a.totalPrinted - a.totalUsed;
        const bNonSold = b.totalPrinted - b.totalUsed;
        return bNonSold - aNonSold;
      });
    case "nom":
      return copy.sort((a, b) => a.vendor.name.localeCompare(b.vendor.name, "fr"));
  }
}

/* ─── main page ───────────────────────────────────────────────── */
export default function Reports() {
  const { data: summaries = [], isLoading } = useGetVendorReportsSummary({ query: { refetchInterval: 10_000 } });
  const [selectedVendorId, setSelectedVendorId] = useState<number | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("vendu-desc");

  const routerId = (() => {
    try { const v = localStorage.getItem("vouchernet_router_id"); return v ? parseInt(v) : null; } catch { return null; }
  })();

  const sorted = useMemo(() => sortSummaries(summaries, sortMode), [summaries, sortMode]);

  if (selectedVendorId) {
    return <VendorDetailReport vendorId={selectedVendorId} onBack={() => setSelectedVendorId(null)} />;
  }

  const totalVouchers = summaries.reduce((s, r) => s + r.totalVouchers, 0);
  const totalUsed     = summaries.reduce((s, r) => s + r.totalUsed, 0);
  const totalDist     = summaries.reduce((s, r) => s + r.totalPrinted - r.totalUsed, 0);
  const totalAvail    = totalVouchers - summaries.reduce((s, r) => s + r.totalPrinted, 0);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Rapports de vente</h1>
          <p className="text-sm text-gray-500">Suivi des vouchers par vendeur</p>
        </div>
        <div className="flex items-center gap-2">
          <SyncButton routerId={routerId} />
        </div>
      </div>

      {totalVouchers > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center gap-2">
                <div className="h-9 w-9 rounded-lg bg-blue-100 flex items-center justify-center">
                  <Ticket className="h-4 w-4 text-blue-600" />
                </div>
                <div><p className="text-xs text-gray-500">Total</p><p className="text-xl font-bold">{totalVouchers}</p></div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center gap-2">
                <div className="h-9 w-9 rounded-lg bg-green-100 flex items-center justify-center">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                </div>
                <div><p className="text-xs text-gray-500">Utilisés</p><p className="text-xl font-bold text-green-600">{totalUsed}</p></div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center gap-2">
                <div className="h-9 w-9 rounded-lg bg-amber-100 flex items-center justify-center">
                  <ShoppingCart className="h-4 w-4 text-amber-600" />
                </div>
                <div><p className="text-xs text-gray-500">Distribués</p><p className="text-xl font-bold text-amber-600">{totalDist}</p></div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center gap-2">
                <div className="h-9 w-9 rounded-lg bg-blue-50 flex items-center justify-center">
                  <PackageOpen className="h-4 w-4 text-blue-500" />
                </div>
                <div><p className="text-xs text-gray-500">Disponibles</p><p className="text-xl font-bold text-blue-500">{totalAvail}</p></div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Chargement des rapports...</div>
      ) : summaries.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <BarChart3 className="h-12 w-12 text-gray-300 mb-4" />
            <p className="text-gray-500 font-medium">Aucun rapport disponible</p>
            <p className="text-sm text-gray-400 mt-1">Ajoutez des vendeurs et générez des vouchers pour voir les rapports</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-gray-500">{summaries.length} vendeur(s)</p>
            <div className="flex items-center gap-2">
              <ArrowDownUp className="h-3.5 w-3.5 text-gray-400" />
              <Select value={sortMode} onValueChange={(v) => setSortMode(v as SortMode)}>
                <SelectTrigger className="w-48 h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vendu-desc">Plus vendus en premier</SelectItem>
                  <SelectItem value="vendu-asc">Moins vendus en premier</SelectItem>
                  <SelectItem value="non-vendu">Non vendus en premier</SelectItem>
                  <SelectItem value="nom">Nom (A → Z)</SelectItem>
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
