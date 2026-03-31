import { useState } from "react";
import {
  useGetVendorReportsSummary,
  useGetVendorReport,
} from "@workspace/api-client-react";
import type { VendorSummary } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  BarChart3,
  Users,
  Ticket,
  ShoppingCart,
  PackageOpen,
  ArrowLeft,
  CalendarDays,
  CalendarClock,
  TrendingUp,
} from "lucide-react";

function AvailabilityBar({ sold, total }: { sold: number; total: number }) {
  const soldPct  = total > 0 ? Math.round((sold  / total) * 100) : 0;
  const availPct = 100 - soldPct;
  const available = total - sold;

  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-green-600 font-medium">{sold} vendus</span>
        <span className="text-gray-400">{available} disponibles</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden flex">
        <div
          className="h-full bg-green-500 rounded-l-full transition-all"
          style={{ width: `${soldPct}%` }}
          title={`${soldPct}% vendus`}
        />
        <div
          className="h-full bg-blue-200 transition-all"
          style={{ width: `${availPct}%` }}
          title={`${availPct}% disponibles`}
        />
      </div>
      <div className="flex gap-3 mt-1">
        <span className="flex items-center gap-1 text-xs text-gray-400">
          <span className="inline-block w-2 h-2 rounded-full bg-green-500" />Vendus {soldPct}%
        </span>
        <span className="flex items-center gap-1 text-xs text-gray-400">
          <span className="inline-block w-2 h-2 rounded-full bg-blue-200" />Disponibles {availPct}%
        </span>
      </div>
    </div>
  );
}

function SalesMiniCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className={`flex flex-col items-center justify-center rounded-lg p-2 ${color}`}>
      <Icon className="h-4 w-4 mb-0.5 opacity-70" />
      <span className="text-lg font-bold leading-none">{value}</span>
      <span className="text-xs mt-0.5 text-center leading-tight opacity-80">{label}</span>
    </div>
  );
}

function VendorDetailReport({ vendorId, onBack }: { vendorId: number; onBack: () => void }) {
  const { data, isLoading } = useGetVendorReport(vendorId);

  if (isLoading || !data) {
    return (
      <div className="text-center py-12 text-gray-400">Chargement du rapport...</div>
    );
  }

  const available = data.totalVouchers - data.totalPrinted;
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

      {/* Stock totaux */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <Ticket className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Total généré</p>
                <p className="text-2xl font-bold text-gray-900">{data.totalVouchers}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-green-100 flex items-center justify-center">
                <ShoppingCart className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Vendus</p>
                <p className="text-2xl font-bold text-green-600">{data.totalPrinted}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-50 flex items-center justify-center">
                <PackageOpen className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Non vendus</p>
                <p className="text-2xl font-bold text-blue-500">{available}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Ventes par période */}
      <Card className="mb-5">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-blue-500" />
            Performance de vente
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-3">
            <SalesMiniCard label="Aujourd'hui" value={ss.todaySold}     icon={CalendarDays}  color="bg-green-50 text-green-700" />
            <SalesMiniCard label="Hier"         value={ss.yesterdaySold} icon={CalendarDays}  color="bg-amber-50 text-amber-700" />
            <SalesMiniCard label="Cette semaine" value={ss.weekSold}    icon={CalendarClock} color="bg-blue-50 text-blue-700" />
            <SalesMiniCard label="Mois dernier"  value={ss.lastMonthSold} icon={BarChart3}    color="bg-purple-50 text-purple-700" />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Par forfait</CardTitle>
          </CardHeader>
          <CardContent>
            {data.byProfile.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">Aucun voucher généré</p>
            ) : (
              <div className="space-y-4">
                {data.byProfile.map((stat) => {
                  const sold = Number(stat.printed);
                  return (
                    <div key={stat.profileName}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm font-medium">{stat.profileName}</span>
                        <span className="text-xs text-gray-400">{stat.total} total</span>
                      </div>
                      <AvailabilityBar sold={sold} total={stat.total} />
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Derniers vouchers</CardTitle>
          </CardHeader>
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
                      {v.printedAt ? (
                        <Badge variant="default" className="text-xs bg-green-600">Vendu</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs text-blue-600 border-blue-300">Disponible</Badge>
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

function VendorCard({ summary, onClick }: { summary: VendorSummary; onClick: () => void }) {
  const sold      = summary.totalPrinted;
  const available = summary.totalVouchers - summary.totalPrinted;
  const ss        = summary.salesStats;

  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-shadow"
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
              <Users className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <CardTitle className="text-base">{summary.vendor.name}</CardTitle>
              {summary.vendor.phone && (
                <p className="text-xs text-gray-500">{summary.vendor.phone}</p>
              )}
            </div>
          </div>
          <Badge variant={summary.vendor.isActive ? "default" : "secondary"}>
            {summary.vendor.isActive ? "Actif" : "Inactif"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {/* Stock */}
        <div className="grid grid-cols-3 gap-3 text-center mb-3">
          <div>
            <p className="text-xl font-bold text-gray-900">{summary.totalVouchers}</p>
            <p className="text-xs text-gray-500">Générés</p>
          </div>
          <div>
            <p className="text-xl font-bold text-green-600">{sold}</p>
            <p className="text-xs text-green-600">Vendus</p>
          </div>
          <div>
            <p className="text-xl font-bold text-blue-500">{available}</p>
            <p className="text-xs text-blue-500">Disponibles</p>
          </div>
        </div>

        {/* Barre */}
        <AvailabilityBar sold={sold} total={summary.totalVouchers} />

        {/* Stats de vente par période */}
        <div className="mt-3 pt-3 border-t border-gray-100">
          <div className="grid grid-cols-4 gap-1.5">
            <SalesMiniCard label="Auj." value={ss.todaySold}     icon={CalendarDays}  color="bg-green-50 text-green-700" />
            <SalesMiniCard label="Hier" value={ss.yesterdaySold} icon={CalendarDays}  color="bg-amber-50 text-amber-700" />
            <SalesMiniCard label="Semaine" value={ss.weekSold}    icon={CalendarClock} color="bg-blue-50 text-blue-700" />
            <SalesMiniCard label="Mois-1" value={ss.lastMonthSold} icon={BarChart3}    color="bg-purple-50 text-purple-700" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Reports() {
  const { data: summaries = [], isLoading } = useGetVendorReportsSummary();
  const [selectedVendorId, setSelectedVendorId] = useState<number | null>(null);

  if (selectedVendorId) {
    return (
      <VendorDetailReport
        vendorId={selectedVendorId}
        onBack={() => setSelectedVendorId(null)}
      />
    );
  }

  const totalVouchers = summaries.reduce((s, r) => s + r.totalVouchers, 0);
  const totalSold     = summaries.reduce((s, r) => s + r.totalPrinted, 0);
  const totalAvail    = totalVouchers - totalSold;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Rapports de vente</h1>
        <p className="text-sm text-gray-500">Suivi des vouchers par vendeur</p>
      </div>

      {totalVouchers > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
                  <Ticket className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Total générés</p>
                  <p className="text-2xl font-bold">{totalVouchers}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-green-100 flex items-center justify-center">
                  <ShoppingCart className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Vendus</p>
                  <p className="text-2xl font-bold text-green-600">{totalSold}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-blue-50 flex items-center justify-center">
                  <PackageOpen className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Non vendus</p>
                  <p className="text-2xl font-bold text-blue-500">{totalAvail}</p>
                </div>
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
            <p className="text-sm text-gray-400 mt-1">
              Ajoutez des vendeurs et générez des vouchers pour voir les rapports
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {summaries.map((summary) => (
            <VendorCard
              key={summary.vendor.id}
              summary={summary}
              onClick={() => setSelectedVendorId(summary.vendor.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
