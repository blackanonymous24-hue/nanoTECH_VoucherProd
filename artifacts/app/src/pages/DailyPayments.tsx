import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Loader2, CreditCard, CheckCircle2, ChevronDown, ChevronUp, Users, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRouterContext } from "@/contexts/RouterContext";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function fmtDateFr(iso: string) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function fmtAmount(n: number) {
  return n.toLocaleString("fr-FR");
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** Ajoute 1 jour à une date ISO pour que le backend l'inclue dans la fenêtre (windowEnd = date - 1). */
function nextDayIso(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

interface DailyArrearEntry {
  date: string;
  salesAmount: number;
  paidAmount: number;
  remaining: number;
  payments: { id: number; amount: number }[];
}

interface DailyArrearsResponse {
  arrears: Record<string, DailyArrearEntry[]>;
  vendorInfo?: Record<string, { name: string }>;
}

interface VendorRow {
  vendorId: number;
  vendorName: string;
  arrears: DailyArrearEntry[];
  totalRemaining: number;
}

/* ── Per-arrear payment row ────────────────────────────────── */
function ArrearRow({
  vendorId,
  entry,
  routerId,
  onDone,
}: {
  vendorId: number;
  entry: DailyArrearEntry;
  routerId: number;
  onDone: () => void;
}) {
  const [amount, setAmount]   = useState(String(entry.remaining));
  const [loading, setLoading] = useState(false);
  const [done, setDone]       = useState(false);

  const pay = useCallback(async (amt: number) => {
    if (amt <= 0 || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/vendors/${vendorId}/daily-payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routerId, date: entry.date, amount: Math.round(amt) }),
      });
      if (res.ok) { setDone(true); onDone(); }
    } finally {
      setLoading(false);
    }
  }, [vendorId, routerId, entry.date, loading, onDone]);

  const handleSolder = () => void pay(entry.remaining);
  const handlePay    = () => void pay(Number(amount));

  return (
    <div className={`flex items-center gap-2 px-3 py-2 border-t border-orange-100 text-xs ${done ? "opacity-50" : ""}`}>
      {/* Date + montant */}
      <div className="flex-1 min-w-0">
        <span className="font-medium text-gray-700">{fmtDateFr(entry.date)}</span>
        {entry.paidAmount > 0 && (
          <span className="ml-2 text-gray-400 tabular-nums">
            versé {fmtAmount(entry.paidAmount)} / {fmtAmount(entry.salesAmount)} FCFA
          </span>
        )}
      </div>

      {/* Reste */}
      <span className="font-bold text-orange-700 tabular-nums flex-shrink-0">
        {fmtAmount(entry.remaining)} FCFA
      </span>

      {done ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />
      ) : (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Custom amount input */}
          <Input
            type="number"
            min={1}
            max={entry.remaining}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="h-7 w-24 text-xs px-2 text-right tabular-nums"
            disabled={loading}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs px-2"
            disabled={loading || Number(amount) <= 0}
            onClick={handlePay}
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Payer"}
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs px-2 bg-emerald-600 hover:bg-emerald-700 text-white"
            disabled={loading}
            onClick={handleSolder}
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Solder"}
          </Button>
        </div>
      )}
    </div>
  );
}

/* ── Per-vendor card ────────────────────────────────────────── */
function VendorCard({
  row,
  routerId,
  onRefresh,
}: {
  row: VendorRow;
  routerId: number;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <Card className={`overflow-hidden border ${row.totalRemaining > 0 ? "border-orange-200" : "border-gray-100"}`}>
      {/* Card header */}
      <button
        className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors ${
          row.totalRemaining > 0 ? "bg-orange-50 hover:bg-orange-100" : "bg-gray-50 hover:bg-gray-100"
        }`}
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <AlertTriangle className={`h-4 w-4 flex-shrink-0 ${row.totalRemaining > 0 ? "text-orange-500" : "text-gray-300"}`} />
          <span className="font-semibold text-gray-800 truncate">{row.vendorName}</span>
          <span className="text-xs text-gray-400 flex-shrink-0">
            ({row.arrears.length} jour{row.arrears.length > 1 ? "s" : ""})
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          <span className={`text-sm font-bold tabular-nums ${row.totalRemaining > 0 ? "text-orange-700" : "text-gray-400"}`}>
            {fmtAmount(row.totalRemaining)} FCFA
          </span>
          {expanded
            ? <ChevronUp className="h-4 w-4 text-gray-400" />
            : <ChevronDown className="h-4 w-4 text-gray-400" />}
        </div>
      </button>

      {/* Arrear rows */}
      {expanded && row.arrears.length > 0 && (
        <CardContent className="p-0">
          {row.arrears.map((a) => (
            <ArrearRow
              key={a.date}
              vendorId={row.vendorId}
              entry={a}
              routerId={routerId}
              onDone={onRefresh}
            />
          ))}
        </CardContent>
      )}
      {expanded && row.arrears.length === 0 && (
        <CardContent className="py-4 text-center text-xs text-gray-400">Aucun arriéré</CardContent>
      )}
    </Card>
  );
}

/* ── Main page ──────────────────────────────────────────────── */
export default function DailyPayments() {
  const { selectedRouterId } = useRouterContext();
  const [date, setDate]      = useState(todayIso);
  const queryClient          = useQueryClient();

  const queryDate = nextDayIso(date);

  const { data, isLoading, isFetching } = useQuery<DailyArrearsResponse>({
    queryKey: ["vendor-daily-arrears", selectedRouterId, queryDate],
    queryFn: async ({ signal }) => {
      if (!selectedRouterId) return { arrears: {} };
      const params = new URLSearchParams({ date: queryDate, routerId: String(selectedRouterId) });
      const res = await fetch(`${BASE}/api/vendors/daily-arrears?${params}`, { signal });
      if (!res.ok) return { arrears: {} };
      return res.json() as Promise<DailyArrearsResponse>;
    },
    enabled: !!selectedRouterId,
    staleTime: 60_000,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["vendor-daily-arrears", selectedRouterId, queryDate] });
  }, [queryClient, selectedRouterId, queryDate]);

  /* Build sorted vendor rows */
  const rows: VendorRow[] = [];
  if (data) {
    for (const [vIdStr, arrears] of Object.entries(data.arrears)) {
      const vId   = Number(vIdStr);
      const name  = data.vendorInfo?.[vIdStr]?.name ?? `Vendeur ${vId}`;
      const total = arrears.reduce((s, a) => s + a.remaining, 0);
      rows.push({ vendorId: vId, vendorName: name, arrears, totalRemaining: total });
    }
    rows.sort((a, b) => b.totalRemaining - a.totalRemaining);
  }

  const grandTotal = rows.reduce((s, r) => s + r.totalRemaining, 0);
  const vendorsWithArrears = rows.filter((r) => r.totalRemaining > 0).length;

  if (!selectedRouterId) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-12 text-center text-gray-400">
            <CreditCard className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p>Sélectionner un routeur pour voir les versements.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 max-w-2xl mx-auto">
      {/* Header */}
      <Card>
        <CardHeader className="pb-3 border-b border-gray-100">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CreditCard className="h-5 w-5 text-blue-500" />
              Versement du jour
            </CardTitle>

            {/* Date selector */}
            <div className="flex items-center gap-2">
              {(isLoading || isFetching) && (
                <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
              )}
              <div className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5">
                <CalendarDays className="h-3.5 w-3.5 text-gray-400" />
                <input
                  type="date"
                  value={date}
                  max={todayIso()}
                  onChange={(e) => setDate(e.target.value)}
                  className="text-xs bg-transparent outline-none text-gray-700 tabular-nums w-32"
                />
              </div>
            </div>
          </div>

          {/* Summary strip */}
          {!isLoading && rows.length > 0 && (
            <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
              <span>
                <span className="font-semibold text-gray-700">{vendorsWithArrears}</span>
                {" "}vendeur{vendorsWithArrears > 1 ? "s" : ""} avec arriérés
              </span>
              <span>
                Total dû :{" "}
                <span className="font-bold text-orange-700 tabular-nums">{fmtAmount(grandTotal)} FCFA</span>
              </span>
            </div>
          )}
        </CardHeader>
      </Card>

      {/* Loading skeleton */}
      {isLoading && (
        <div className="flex items-center justify-center py-12 gap-2 text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Chargement…</span>
        </div>
      )}

      {/* No data */}
      {!isLoading && rows.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-gray-400">
            <Users className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Aucun arriéré pour cette date.</p>
          </CardContent>
        </Card>
      )}

      {/* Vendor cards */}
      {!isLoading && rows.map((row) => (
        <VendorCard
          key={row.vendorId}
          row={row}
          routerId={selectedRouterId}
          onRefresh={refresh}
        />
      ))}
    </div>
  );
}
