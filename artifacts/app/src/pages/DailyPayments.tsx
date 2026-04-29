import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invalidateAllPaymentQueries } from "@/lib/invalidatePayments";
import { CalendarDays, Loader2, CreditCard, CheckCircle2, ChevronDown, ChevronUp, Users, AlertTriangle, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
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
  onOptimisticDeletePayment,
}: {
  vendorId: number;
  entry: DailyArrearEntry;
  routerId: number;
  onDone: () => Promise<void> | void;
  onOptimisticDeletePayment: (vendorId: number, date: string, paymentId: number) => void;
}) {
  const [amount, setAmount]   = useState(String(entry.remaining));
  const [loading, setLoading] = useState(false);
  const [done, setDone]       = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const { toast } = useToast();

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

  const deletePayment = useCallback(async (paymentId: number, paymentAmount: number) => {
    if (deletingId !== null) return;
    if (!window.confirm(`Annuler le versement de ${fmtAmount(paymentAmount)} FCFA du ${fmtDateFr(entry.date)} ?`)) return;
    setDeletingId(paymentId);
    try {
      const res = await fetch(`${BASE}/api/vendors/daily-payments/${paymentId}`, { method: "DELETE" });
      if (!res.ok) {
        toast({ title: "Erreur lors de la suppression", variant: "destructive" });
        return;
      }
      // Update optimiste : retire le versement de l'affichage tout de suite
      // pour éviter une attente quand l'API est lente (MikroTik).
      onOptimisticDeletePayment(vendorId, entry.date, paymentId);
      toast({ title: "Versement supprimé" });
      // Re-active la ligne si on l'avait marquée "soldée" puis qu'on retire un paiement.
      setDone(false);
      // Refetch en arrière-plan pour resynchroniser totaux et arriérés.
      void onDone();
    } finally {
      setDeletingId(null);
    }
  }, [deletingId, entry.date, vendorId, onDone, onOptimisticDeletePayment, toast]);

  const handleSolder = () => void pay(entry.remaining);
  const handlePay    = () => void pay(Number(amount));

  return (
    <div className={`px-3 py-2 border-t border-orange-100 text-xs ${done ? "opacity-50" : ""}`}>
      {/* Mobile: stacks (date+paid on row 1, reste on row 2, controls on row 3).
          Desktop (sm+): single horizontal row. */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2">
        {/* Date + montant versé */}
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 sm:flex-1 sm:min-w-0">
          <span className="font-medium text-gray-700">{fmtDateFr(entry.date)}</span>
          {entry.paidAmount > 0 && (
            <span className="text-gray-400 tabular-nums">
              versé {fmtAmount(entry.paidAmount)} / {fmtAmount(entry.salesAmount)} FCFA
            </span>
          )}
        </div>

        {/* Reste + actions. Wrap autorisé pour les écrans très étroits
            (~320 px) afin que les boutons ne débordent jamais. */}
        <div className="flex flex-wrap items-center gap-1.5 justify-between sm:justify-end">
          <span className="font-bold text-orange-700 tabular-nums flex-shrink-0">
            {fmtAmount(entry.remaining)} FCFA
          </span>

          {done ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />
          ) : (
            <div className="flex items-center gap-1.5 flex-shrink-0 ml-auto">
              {/* Custom amount input */}
              <Input
                type="number"
                min={1}
                max={entry.remaining}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-7 w-20 sm:w-24 text-xs px-2 text-right tabular-nums"
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
      </div>

      {/* Versements déjà enregistrés pour cet arriéré (annulables) */}
      {entry.payments.length > 0 && (
        <div className="mt-1.5 flex items-center gap-1 flex-wrap pl-2">
          <span className="text-[10px] text-gray-400 mr-1">Versements :</span>
          {entry.payments.map((p) => (
            <span
              key={p.id}
              className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 pl-2 pr-1 py-0.5 text-[10px] text-emerald-700"
            >
              <span className="font-semibold tabular-nums">{fmtAmount(p.amount)}</span>
              <button
                type="button"
                onClick={() => void deletePayment(p.id, p.amount)}
                disabled={deletingId === p.id}
                className="ml-0.5 rounded-full p-0.5 hover:bg-emerald-100 hover:text-red-600 disabled:opacity-50"
                title="Annuler ce versement"
                aria-label={`Annuler le versement de ${p.amount} FCFA`}
              >
                {deletingId === p.id
                  ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  : <X className="h-2.5 w-2.5" />}
              </button>
            </span>
          ))}
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
  onOptimisticDeletePayment,
}: {
  row: VendorRow;
  routerId: number;
  onRefresh: () => void;
  onOptimisticDeletePayment: (vendorId: number, date: string, paymentId: number) => void;
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
              onOptimisticDeletePayment={onOptimisticDeletePayment}
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

  const refresh = useCallback(
    () => invalidateAllPaymentQueries(queryClient, selectedRouterId),
    [queryClient, selectedRouterId],
  );

  // Update optimiste : retire localement un versement annulé pour que la
  // disparition soit instantanée, sans attendre le refetch de l'API.
  const onOptimisticDeletePayment = useCallback(
    (vendorId: number, date: string, paymentId: number) => {
      queryClient.setQueryData<DailyArrearsResponse>(
        ["vendor-daily-arrears", selectedRouterId, queryDate],
        (old) => {
          if (!old) return old;
          const vIdStr = String(vendorId);
          const vendorArrears = old.arrears[vIdStr];
          if (!vendorArrears) return old;
          const newVendorArrears = vendorArrears.map((a) => {
            if (a.date !== date) return a;
            const removed = a.payments.find((p) => p.id === paymentId);
            if (!removed) return a;
            const newPayments  = a.payments.filter((p) => p.id !== paymentId);
            const newPaid      = Math.max(0, a.paidAmount - removed.amount);
            const newRemaining = Math.max(0, a.salesAmount - newPaid);
            return { ...a, payments: newPayments, paidAmount: newPaid, remaining: newRemaining };
          });
          return { ...old, arrears: { ...old.arrears, [vIdStr]: newVendorArrears } };
        },
      );
    },
    [queryClient, selectedRouterId, queryDate],
  );

  /* Build sorted vendor rows */
  const rows: VendorRow[] = [];
  if (data) {
    for (const [vIdStr, arrears] of Object.entries(data.arrears)) {
      const vId   = Number(vIdStr);
      const name  = data.vendorInfo?.[vIdStr]?.name ?? `Vendeur ${vId}`;
      const total = arrears.reduce((s, a) => s + a.remaining, 0);
      rows.push({ vendorId: vId, vendorName: name, arrears, totalRemaining: total });
    }
    rows.sort((a, b) => a.vendorName.localeCompare(b.vendorName, "fr", { sensitivity: "base" }));
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
        <div className="py-6 space-y-2">
          <Skeleton className="h-6 w-40 mx-auto" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-10/12" />
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
          onOptimisticDeletePayment={onOptimisticDeletePayment}
        />
      ))}
    </div>
  );
}
