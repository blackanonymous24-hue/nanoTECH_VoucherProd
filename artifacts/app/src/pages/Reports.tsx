import { useState } from "react";
import {
  useGetVendorReportsSummary,
  useGetVendorReport,
} from "@workspace/api-client-react";
import type { VendorSummary } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BarChart3, Users, Ticket, Printer, ArrowLeft, TrendingUp } from "lucide-react";

function VendorDetailReport({ vendorId, onBack }: { vendorId: number; onBack: () => void }) {
  const { data, isLoading } = useGetVendorReport(vendorId);

  if (isLoading || !data) {
    return (
      <div className="text-center py-12 text-gray-400">Chargement du rapport...</div>
    );
  }

  const printRate = data.totalVouchers > 0
    ? Math.round((data.totalPrinted / data.totalVouchers) * 100)
    : 0;

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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
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
                <Printer className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Imprimés</p>
                <p className="text-2xl font-bold text-gray-900">{data.totalPrinted}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-orange-100 flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Taux d'impression</p>
                <p className="text-2xl font-bold text-gray-900">{printRate}%</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Par forfait</CardTitle>
          </CardHeader>
          <CardContent>
            {data.byProfile.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">Aucun voucher généré</p>
            ) : (
              <div className="space-y-3">
                {data.byProfile.map((stat) => {
                  const pct = stat.total > 0 ? Math.round((stat.printed / stat.total) * 100) : 0;
                  return (
                    <div key={stat.profileName}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium">{stat.profileName}</span>
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <span>{stat.printed}/{stat.total} imprimés</span>
                          <Badge variant="outline" className="text-xs">{pct}%</Badge>
                        </div>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Derniers vouchers générés</CardTitle>
          </CardHeader>
          <CardContent>
            {data.recentVouchers.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">Aucun voucher</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {data.recentVouchers.map((v) => (
                  <div key={v.id} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                    <div>
                      <span className="text-sm font-mono font-medium">{v.username}</span>
                      <span className="text-xs text-gray-400 ml-2">/ {v.password}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">{v.profileName}</span>
                      {v.printedAt ? (
                        <Badge variant="default" className="text-xs bg-green-600">Imprimé</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs text-orange-600 border-orange-300">En attente</Badge>
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
  const printRate = summary.totalVouchers > 0
    ? Math.round((summary.totalPrinted / summary.totalVouchers) * 100)
    : 0;

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
        <div className="grid grid-cols-3 gap-3 text-center mb-3">
          <div>
            <p className="text-xl font-bold text-gray-900">{summary.totalVouchers}</p>
            <p className="text-xs text-gray-500">Générés</p>
          </div>
          <div>
            <p className="text-xl font-bold text-green-600">{summary.totalPrinted}</p>
            <p className="text-xs text-gray-500">Imprimés</p>
          </div>
          <div>
            <p className="text-xl font-bold text-orange-600">{summary.totalVouchers - summary.totalPrinted}</p>
            <p className="text-xs text-gray-500">En attente</p>
          </div>
        </div>
        <div className="mt-2">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Taux d'impression</span>
            <span>{printRate}%</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full"
              style={{ width: `${printRate}%` }}
            />
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
  const totalPrinted = summaries.reduce((s, r) => s + r.totalPrinted, 0);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Rapports de vente</h1>
        <p className="text-sm text-gray-500">Suivi des vouchers générés par vendeur</p>
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
                  <p className="text-sm text-gray-500">Total tous vendeurs</p>
                  <p className="text-2xl font-bold">{totalVouchers}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-green-100 flex items-center justify-center">
                  <Printer className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Imprimés</p>
                  <p className="text-2xl font-bold text-green-600">{totalPrinted}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-gray-100 flex items-center justify-center">
                  <BarChart3 className="h-5 w-5 text-gray-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Vendeurs actifs</p>
                  <p className="text-2xl font-bold">{summaries.filter((s) => s.vendor.isActive).length}</p>
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
