import { useState, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invalidateAllPaymentQueries } from "@/lib/invalidatePayments";
import { useRouterContext } from "@/contexts/RouterContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Wallet, Users, Loader2, AlertCircle, CheckCircle2, Trash2, Plus,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight, AlertTriangle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function deleteWithRetry(url: string, attempts = 3): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { method: "DELETE" });
      if (res.ok) return res;
      if (res.status >= 500 && i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 250 * (i + 1)));
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 250 * (i + 1)));
        continue;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Échec réseau");
}

const MONTH_NAMES_FR = [
  "Janvier","Février","Mars","Avril","Mai","Juin",
  "Juillet","Août","Septembre","Octobre","Novembre","Décembre",
];

function fmtAmount(n: number) {
  return n === 0 ? "0" : n.toLocaleString("fr-FR");
}

function fmtDateFr(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d} ${MONTH_NAMES_FR[parseInt(m, 10) - 1]} ${y}`;
}

function fmtDateShort(iso: string) {
  const [, m, d] = iso.split("-");
  return `${d} ${MONTH_NAMES_FR[parseInt(m, 10) - 1]}`;
}

function tomorrowStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Returns YYYY-MM-DD of Monday of the current week (UTC) */
function currentMonday(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(now);
  mon.setUTCDate(now.getUTCDate() + diff);
  return mon.toISOString().slice(0, 10);
}

/** Returns YYYY-MM-DD of Monday N weeks before the given monday string */
function mondayNWeeksAgo(baseMondayStr: string, n: number): string {
  const mon = new Date(baseMondayStr + "T00:00:00Z");
  mon.setUTCDate(mon.getUTCDate() - n * 7);
  return mon.toISOString().slice(0, 10);
}

/** Label "dd Mmm – dd Mmm yyyy" for a given Monday */
function weekLabel(mondayStr: string): string {
  const mon = new Date(mondayStr + "T00:00:00Z");
  const sun = new Date(mon.getTime() + 6 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) =>
    `${String(d.getUTCDate()).padStart(2, "0")} ${MONTH_NAMES_FR[d.getUTCMonth()]}`;
  return `${fmt(mon)} – ${fmt(sun)} ${sun.getUTCFullYear()}`;
}

interface PaymentEntry {
  id: number;
  amount: number;
  paidAt: string;
  note: string | null;
  // "weekly" = vendorPaymentsTable (lump-sum); "daily" = vendorDailyPaymentsTable.
  // Indispensable pour router la suppression vers le bon endpoint.
  // Optionnel pour rester compatible avec d'anciens clients en cache.
  source?: "weekly" | "daily";
}

interface VendorWeekEntry {
  vendorId: number;
  vendorName: string;
  count: number;
  amount: number;
  commission: number;
  commissionRate: number;
  weeklyPaid?: number;       // lump-sum weekly payments only
  dailyPaid?: number;        // daily payments only
  weeklyExpected?: number;   // amount - commission - dailyPaid (what still must be paid weekly)
  totalPaid: number;
  remaining: number;
  payments: PaymentEntry[];
}

interface WeeklySummaryResponse {
  weekStart: string;
  vendors: VendorWeekEntry[];
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

/** Consolidated arrears entry: when >3 daily arrears, merge all but the 2 most recent into one line dated the most recent of the merged days. */
type ConsolidatableArrearEntry = DailyArrearEntry & { __underlying?: DailyArrearEntry[] };
function consolidateArrears(entries: DailyArrearEntry[]): ConsolidatableArrearEntry[] {
  // Always return ascending (oldest first, most recent last)
  const asc = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  if (asc.length <= 3) return asc;
  const older = asc.slice(0, asc.length - 2); // all but the 2 most recent
  const recent = asc.slice(asc.length - 2);   // 2 most recent, ascending
  const merged: ConsolidatableArrearEntry = {
    date: older[older.length - 1].date, // most recent of the merged (older) days
    salesAmount: older.reduce((s, e) => s + e.salesAmount, 0),
    paidAmount:  older.reduce((s, e) => s + e.paidAmount,  0),
    remaining:   older.reduce((s, e) => s + e.remaining,   0),
    payments:    older.flatMap((e) => e.payments),
    __underlying: older,
  };
  return [merged, ...recent];
}

/* ── Single vendor row with payment form ─────────────────────────────── */
function VendorRow({
  vendor,
  routerId,
  weekStart,
  onMutated,
  onOptimisticDeletePayment,
}: {
  vendor: VendorWeekEntry;
  routerId: number;
  weekStart: string;
  onMutated: () => Promise<void> | void;
  onOptimisticDeletePayment: (vendorId: number, paymentId: number, source: "weekly" | "daily") => void;
}) {
  const [open, setOpen]     = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote]     = useState("");
  const { toast } = useToast();

  const isFullyPaid = vendor.remaining === 0 && vendor.totalPaid > 0;

  const addPayment = async () => {
    const amt = parseInt(amount.replace(/\s/g, ""), 10);
    if (!amt || amt <= 0) { toast({ title: "Montant invalide", variant: "destructive" }); return; }
    const res = await fetch(`${BASE}/api/vendors/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorId: vendor.vendorId, routerId, weekStart, amount: amt, note: note.trim() || undefined }),
    });
    if (!res.ok) { toast({ title: "Erreur", description: await res.text(), variant: "destructive" }); return; }
    setAmount("");
    setNote("");
    onMutated();
    toast({ title: "Versement enregistré", description: `${fmtAmount(amt)} FCFA pour ${vendor.vendorName}` });
  };

  const [deletingId, setDeletingId] = useState<number | null>(null);
  const deletePayment = async (id: number, amt: number, source: "weekly" | "daily" | undefined) => {
    if (deletingId !== null) return;
    if (!window.confirm(`Annuler le versement de ${fmtAmount(amt)} FCFA ?`)) return;
    setDeletingId(id);
    try {
      const tryDelete = async (src: "weekly" | "daily") => {
        const url = src === "daily"
          ? `${BASE}/api/vendors/daily-payments/${id}`
          : `${BASE}/api/vendors/payments/${id}`;
        const res = await deleteWithRetry(url);
        return { src, res };
      };

      let chosen: "weekly" | "daily" | null = null;
      if (source) {
        const { src, res } = await tryDelete(source);
        if (!res.ok) {
          if (res.status === 404) {
            onOptimisticDeletePayment(vendor.vendorId, id, src);
            toast({ title: "Déjà supprimé", description: "Ce versement était déjà supprimé ou inexistant." });
            void onMutated();
            return;
          }
          const txt = await res.text().catch(() => "");
          toast({ title: "Erreur", description: txt || `HTTP ${res.status}`, variant: "destructive" });
          return;
        }
        chosen = src;
      } else {
        // Old cached entries may miss `source`; try daily first, then weekly.
        const first = await tryDelete("daily");
        if (first.res.ok) {
          chosen = "daily";
        } else if (first.res.status === 404) {
          const second = await tryDelete("weekly");
          if (!second.res.ok) {
            if (second.res.status === 404) {
              // Missing from both tables => remove stale row from UI anyway.
              onOptimisticDeletePayment(vendor.vendorId, id, "weekly");
              toast({ title: "Déjà supprimé", description: "Ce versement était déjà supprimé ou inexistant." });
              void onMutated();
              return;
            }
            const txt = await second.res.text().catch(() => "");
            toast({ title: "Erreur", description: txt || `HTTP ${second.res.status}`, variant: "destructive" });
            return;
          }
          chosen = "weekly";
        } else {
          const txt = await first.res.text().catch(() => "");
          toast({ title: "Erreur", description: txt || `HTTP ${first.res.status}`, variant: "destructive" });
          return;
        }
      }

      if (!chosen) {
        toast({ title: "Erreur", description: "Impossible de déterminer le type de versement.", variant: "destructive" });
        return;
      }
      // 1) Update optimiste : on retire le versement de l'affichage tout
      //    de suite, sans attendre le refetch (qui peut être lent quand
      //    l'API est sous charge MikroTik).
      onOptimisticDeletePayment(vendor.vendorId, id, chosen);
      toast({ title: "Versement annulé" });
      // 2) Refetch en arrière-plan pour resynchroniser totaux et arriérés.
      void onMutated();
    } catch (err) {
      toast({
        title: "Erreur réseau",
        description: err instanceof Error ? err.message : "Impossible de joindre le serveur",
        variant: "destructive",
      });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="border border-gray-100 rounded-lg overflow-hidden">
      <div className="flex items-start gap-2 px-3 py-2.5 bg-white hover:bg-gray-50 transition-colors">
        <div className="flex-1 min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-semibold text-sm text-gray-800 truncate">{vendor.vendorName}</span>
            {isFullyPaid && (
              <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 whitespace-nowrap flex-shrink-0">
                <CheckCircle2 className="h-3 w-3" /> Soldé
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5 text-[11px] text-gray-500">
            <span className="whitespace-nowrap">{vendor.count} ticket{vendor.count !== 1 ? "s" : ""}</span>
            <span className="whitespace-nowrap">Ventes : <span className="font-medium text-gray-700">{fmtAmount(vendor.amount)} FCFA</span></span>
            {vendor.commission > 0 && (
              <span className="whitespace-nowrap">Commission : <span className="font-medium text-violet-600">−{fmtAmount(vendor.commission)} FCFA ({vendor.commissionRate}%)</span></span>
            )}
            {(vendor.dailyPaid ?? 0) > 0 && (
              <span className="whitespace-nowrap">Versé jour : <span className="font-medium text-sky-700">{fmtAmount(vendor.dailyPaid!)} FCFA</span></span>
            )}
            {(vendor.weeklyPaid ?? 0) > 0 && (
              <span className="whitespace-nowrap">Versé sem. : <span className="font-medium text-emerald-700">{fmtAmount(vendor.weeklyPaid!)} FCFA</span></span>
            )}
            {vendor.dailyPaid === undefined && vendor.totalPaid > 0 && (
              <span className="whitespace-nowrap">Versé : <span className="font-medium text-emerald-700">{fmtAmount(vendor.totalPaid)} FCFA</span></span>
            )}
            {(vendor.dailyPaid ?? 0) > 0 && (vendor.weeklyExpected ?? 0) > 0 && (
              <span className="whitespace-nowrap">Hebdo. à régler : <span className="font-semibold text-blue-700">{fmtAmount(vendor.weeklyExpected!)} FCFA</span></span>
            )}
            {vendor.remaining > 0 && (
              <span className="whitespace-nowrap">Reste : <span className="font-semibold text-orange-600">{fmtAmount(vendor.remaining)} FCFA</span></span>
            )}
          </div>
        </div>

        <Button
          size="sm" variant="outline"
          className="h-7 gap-1 text-xs flex-shrink-0 mt-0.5"
          onClick={() => setOpen((v) => !v)}
        >
          <Plus className="h-3.5 w-3.5" />
          Verser
          {open ? <ChevronUp className="h-3 w-3 ml-0.5" /> : <ChevronDown className="h-3 w-3 ml-0.5" />}
        </Button>
      </div>

      {open && (
        <div className="border-t border-gray-100 bg-gray-50 px-3 py-3 space-y-3">
          <div className="space-y-2">
            <div className="flex gap-2 flex-wrap">
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wide">Montant (FCFA)</span>
                <Input
                  type="number" min={1} placeholder="Ex: 33900"
                  value={amount} onChange={(e) => setAmount(e.target.value)}
                  className="h-8 text-xs w-32"
                  onKeyDown={(e) => e.key === "Enter" && addPayment()}
                />
              </div>
              <div className="flex flex-col gap-1 flex-1 min-w-0">
                <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wide">Note (optionnel)</span>
                <Input
                  placeholder="Référence, commentaire…"
                  value={note} onChange={(e) => setNote(e.target.value)}
                  className="h-8 text-xs"
                  onKeyDown={(e) => e.key === "Enter" && addPayment()}
                />
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700" onClick={addPayment} disabled={!amount}>
                <CheckCircle2 className="h-3.5 w-3.5" /> Enregistrer
              </Button>
              {vendor.remaining > 0 && (
                <Button size="sm" variant="outline" className="h-8 text-xs gap-1 whitespace-nowrap" onClick={() => setAmount(String(vendor.remaining))}>
                  Tout verser ({fmtAmount(vendor.remaining)})
                </Button>
              )}
            </div>
          </div>

          {vendor.payments.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Versements enregistrés</p>
              {vendor.payments.map((p) => (
                <div key={p.id} className="flex items-center gap-2 bg-white border border-gray-100 rounded px-2.5 py-1.5 text-xs">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                  <span className="font-semibold text-gray-800 tabular-nums">{fmtAmount(p.amount)} FCFA</span>
                  <span className="text-gray-400">{new Date(p.paidAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</span>
                  {p.note && <span className="text-gray-500 italic truncate flex-1">— {p.note}</span>}
                  <button
                    type="button"
                    className="ml-auto p-1 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0 disabled:opacity-50"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); void deletePayment(p.id, p.amount, p.source); }}
                    disabled={deletingId === p.id}
                    title="Annuler ce versement"
                  >
                    {deletingId === p.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Week section card ───────────────────────────────────────────────── */
function WeekCard({
  label,
  weekStart,
  routerId,
  colorClass,
  queryClient,
  onPrev,
  onNext,
  canGoPrev,
  canGoNext,
}: {
  label: string;
  weekStart: string;
  routerId: number;
  colorClass: string;
  queryClient: ReturnType<typeof useQueryClient>;
  onPrev?: () => void;
  onNext?: () => void;
  canGoPrev?: boolean;
  canGoNext?: boolean;
}) {
  const qk = ["weekly-summary", routerId, weekStart];

  const { data, isLoading, isError } = useQuery<WeeklySummaryResponse>({
    queryKey: qk,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ routerId: String(routerId), weekStart });
      const res = await fetch(`${BASE}/api/vendors/weekly-summary?${params}`, { signal });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    staleTime: 30_000,
  });

  const onMutated = () => invalidateAllPaymentQueries(queryClient, routerId);

  // Update optimiste : retire localement un versement annulé pour que la
  // disparition soit instantanée, sans attendre le refetch (utile quand
  // l'API est ralentie par les appels MikroTik).
  const onOptimisticDeletePayment = useCallback((vendorId: number, paymentId: number, source: "weekly" | "daily") => {
    queryClient.setQueryData<WeeklySummaryResponse>(qk, (old) => {
      if (!old) return old;
      return {
        ...old,
        vendors: old.vendors.map((v) => {
          if (v.vendorId !== vendorId) return v;
          // On filtre par (id, source) car les ids peuvent se croiser entre
          // vendor_payments (weekly) et vendor_daily_payments (daily).
          const removed = v.payments.find((p) => p.id === paymentId && (p.source ?? "weekly") === source);
          if (!removed) return v;
          const newPayments = v.payments.filter((p) => !(p.id === paymentId && (p.source ?? "weekly") === source));
          const newTotalPaid = Math.max(0, v.totalPaid - removed.amount);
          const newWeeklyPaid = source === "weekly" && v.weeklyPaid !== undefined
            ? Math.max(0, v.weeklyPaid - removed.amount)
            : v.weeklyPaid;
          const newDailyPaid = source === "daily" && v.dailyPaid !== undefined
            ? Math.max(0, v.dailyPaid - removed.amount)
            : v.dailyPaid;
          // Reste = ventes − commission − total versé (préserver la commission existante).
          const newRemaining = Math.max(0, v.amount - v.commission - newTotalPaid);
          // weeklyExpected = ventes − commission − dailyPaid (ce qui reste à régler en hebdo)
          const newWeeklyExpected = newDailyPaid !== undefined
            ? Math.max(0, v.amount - v.commission - newDailyPaid)
            : v.weeklyExpected;
          return {
            ...v,
            payments: newPayments,
            totalPaid: newTotalPaid,
            weeklyPaid: newWeeklyPaid,
            dailyPaid: newDailyPaid,
            weeklyExpected: newWeeklyExpected,
            remaining: newRemaining,
          };
        }),
      };
    });
  }, [queryClient, qk]);

  const grandSales      = useMemo(() => (data?.vendors ?? []).reduce((s, v) => s + v.amount, 0), [data]);
  const grandCommission = useMemo(() => (data?.vendors ?? []).reduce((s, v) => s + v.commission, 0), [data]);
  const grandPaid       = useMemo(() => (data?.vendors ?? []).reduce((s, v) => s + v.totalPaid, 0), [data]);
  const grandLeft       = useMemo(() => (data?.vendors ?? []).reduce((s, v) => s + v.remaining, 0), [data]);

  const hasNav = onPrev !== undefined || onNext !== undefined;

  return (
    <Card className="shadow-sm border-gray-100">
      <CardHeader className="pb-2 pt-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 flex-1 min-w-0">
            {hasNav && (
              <button
                onClick={onPrev}
                disabled={!canGoPrev}
                className="h-6 w-6 flex items-center justify-center rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0 transition-colors"
                title="Semaine précédente"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            <span className={`h-2 w-2 rounded-full flex-shrink-0 ${colorClass}`} />
            <span className="truncate">{label}</span>
            {hasNav && (
              <button
                onClick={onNext}
                disabled={!canGoNext}
                className="h-6 w-6 flex items-center justify-center rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0 transition-colors"
                title="Semaine suivante"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </CardTitle>
          {data && data.vendors.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
              <span>Ventes : <span className="font-semibold text-gray-700">{fmtAmount(grandSales)} FCFA</span></span>
              {grandCommission > 0 && (
                <span>Commissions : <span className="font-semibold text-violet-600">−{fmtAmount(grandCommission)} FCFA</span></span>
              )}
              <span>Versé : <span className="font-semibold text-emerald-700">{fmtAmount(grandPaid)} FCFA</span></span>
              {grandLeft > 0 && (
                <span>Reste : <span className="font-semibold text-orange-600">{fmtAmount(grandLeft)} FCFA</span></span>
              )}
            </div>
          )}
        </div>
        <p className="text-xs text-gray-400">{weekLabel(weekStart)}</p>
      </CardHeader>

      <CardContent className="pt-1 pb-4 space-y-2">
        {isLoading && (
          <div className="py-4 space-y-2">
            <Skeleton className="h-5 w-28 mx-auto" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-11/12" />
          </div>
        )}
        {isError && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            Erreur de chargement
          </div>
        )}
        {!isLoading && data?.vendors.length === 0 && (
          <p className="text-center text-xs text-gray-400 py-6">Aucune vente cette semaine</p>
        )}
        {!isLoading && (data?.vendors ?? []).map((v) => (
          <VendorRow key={v.vendorId} vendor={v} routerId={routerId} weekStart={weekStart} onMutated={onMutated} onOptimisticDeletePayment={onOptimisticDeletePayment} />
        ))}
      </CardContent>
    </Card>
  );
}

/* ── Weekly daily payments (current week) — review & correct ─────────── */
interface DailyPaymentWithVendor {
  id: number;
  vendorId: number;
  vendorName: string;
  date: string;
  amount: number;
  note: string | null;
  paidAt: string;
}

function WeeklyDailyPaymentsSection({ routerId }: { routerId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const monday = currentMonday();
  const today  = new Date().toISOString().slice(0, 10);
  const qk = ["weekly-daily-payments", routerId, monday];
  const [deleting, setDeleting] = useState<number | null>(null);

  const { data = [], isLoading } = useQuery<DailyPaymentWithVendor[]>({
    queryKey: qk,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ routerId: String(routerId), from: monday, to: today });
      const res = await fetch(`${BASE}/api/vendors/daily-payments?${params}`, { signal });
      if (!res.ok) return [];
      return res.json() as Promise<DailyPaymentWithVendor[]>;
    },
    staleTime: 30_000,
  });

  const byDate = useMemo(() => {
    const map = new Map<string, DailyPaymentWithVendor[]>();
    for (const p of data) {
      if (!map.has(p.date)) map.set(p.date, []);
      map.get(p.date)!.push(p);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [data]);

  const total = useMemo(() => data.reduce((s, p) => s + p.amount, 0), [data]);

  const handleDelete = async (id: number, amt: number) => {
    if (deleting !== null) return;
    if (!window.confirm(`Annuler le versement de ${fmtAmount(amt)} FCFA ?`)) return;
    setDeleting(id);
    try {
      const res = await deleteWithRetry(`${BASE}/api/vendors/daily-payments/${id}`);
      if (!res.ok) {
        if (res.status === 404) {
          queryClient.setQueryData<DailyPaymentWithVendor[]>(qk, (old) => {
            if (!old) return old;
            return old.filter((p) => p.id !== id);
          });
          toast({ title: "Déjà supprimé", description: "Ce versement était déjà supprimé ou inexistant." });
          void invalidateAllPaymentQueries(queryClient, routerId);
          return;
        }
        const txt = await res.text().catch(() => "");
        toast({ title: "Erreur suppression", description: txt || `HTTP ${res.status}`, variant: "destructive" });
        return;
      }
      // Update optimiste : retire le versement de la liste affichée tout
      // de suite pour éviter une attente quand l'API est lente.
      queryClient.setQueryData<DailyPaymentWithVendor[]>(qk, (old) => {
        if (!old) return old;
        return old.filter((p) => p.id !== id);
      });
      toast({ title: "Versement supprimé" });
      // Refetch en arrière-plan pour resynchroniser totaux et arriérés.
      void invalidateAllPaymentQueries(queryClient, routerId);
    } catch (err) {
      toast({
        title: "Erreur réseau",
        description: err instanceof Error ? err.message : "Impossible de joindre le serveur",
        variant: "destructive",
      });
    } finally {
      setDeleting(null);
    }
  };

  if (isLoading) return (
    <div className="py-4 space-y-2">
      <Skeleton className="h-5 w-28 mx-auto" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-11/12" />
    </div>
  );

  if (byDate.length === 0) return (
    <div className="text-center py-6 text-xs text-gray-400">
      Aucun versement journalier enregistré cette semaine
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-gray-500 px-1">
        <span>{data.length} versement{data.length > 1 ? "s" : ""}</span>
        <span className="font-semibold text-emerald-700">{fmtAmount(total)} FCFA total</span>
      </div>
      {byDate.map(([date, payments]) => (
        <div key={date} className="border border-gray-100 rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-gray-50 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-700">{fmtDateFr(date)}</p>
          </div>
          <div className="divide-y divide-gray-50">
            {payments.map((p) => (
              <div key={p.id} className="flex items-center gap-2 px-3 py-2.5 bg-white">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800 truncate">{p.vendorName}</p>
                  <div className="flex flex-wrap gap-x-2 text-[10px] text-gray-400 mt-0.5">
                    <span>{new Date(p.paidAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
                    {p.note && <span className="italic">· {p.note}</span>}
                  </div>
                </div>
                <span className="text-sm font-bold text-emerald-700 tabular-nums flex-shrink-0">
                  {fmtAmount(p.amount)} FCFA
                </span>
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); void handleDelete(p.id, p.amount); }}
                  disabled={deleting === p.id}
                  className="p-1.5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50 flex-shrink-0"
                  title="Supprimer ce versement"
                >
                  {deleting === p.id
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Trash2 className="h-3.5 w-3.5" />
                  }
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Per-vendor color palette (deterministic by vendorId) ─────────────── */
const VENDOR_COLORS = [
  { border: "border-orange-200",  header: "bg-orange-50 hover:bg-orange-100",   icon: "text-orange-500",  sub: "text-orange-600",  amount: "text-orange-700",  divide: "divide-orange-100"  },
  { border: "border-blue-200",    header: "bg-blue-50 hover:bg-blue-100",       icon: "text-blue-500",    sub: "text-blue-600",    amount: "text-blue-700",    divide: "divide-blue-100"    },
  { border: "border-violet-200",  header: "bg-violet-50 hover:bg-violet-100",   icon: "text-violet-500",  sub: "text-violet-600",  amount: "text-violet-700",  divide: "divide-violet-100"  },
  { border: "border-teal-200",    header: "bg-teal-50 hover:bg-teal-100",       icon: "text-teal-500",    sub: "text-teal-600",    amount: "text-teal-700",    divide: "divide-teal-100"    },
  { border: "border-rose-200",    header: "bg-rose-50 hover:bg-rose-100",       icon: "text-rose-500",    sub: "text-rose-600",    amount: "text-rose-700",    divide: "divide-rose-100"    },
  { border: "border-amber-200",   header: "bg-amber-50 hover:bg-amber-100",     icon: "text-amber-500",   sub: "text-amber-600",   amount: "text-amber-700",   divide: "divide-amber-100"   },
  { border: "border-indigo-200",  header: "bg-indigo-50 hover:bg-indigo-100",   icon: "text-indigo-500",  sub: "text-indigo-600",  amount: "text-indigo-700",  divide: "divide-indigo-100"  },
  { border: "border-sky-200",     header: "bg-sky-50 hover:bg-sky-100",         icon: "text-sky-500",     sub: "text-sky-600",     amount: "text-sky-700",     divide: "divide-sky-100"     },
  { border: "border-fuchsia-200", header: "bg-fuchsia-50 hover:bg-fuchsia-100", icon: "text-fuchsia-500", sub: "text-fuchsia-600", amount: "text-fuchsia-700", divide: "divide-fuchsia-100" },
  { border: "border-cyan-200",    header: "bg-cyan-50 hover:bg-cyan-100",       icon: "text-cyan-500",    sub: "text-cyan-600",    amount: "text-cyan-700",    divide: "divide-cyan-100"    },
  { border: "border-lime-200",    header: "bg-lime-50 hover:bg-lime-100",       icon: "text-lime-600",    sub: "text-lime-700",    amount: "text-lime-800",    divide: "divide-lime-100"    },
  { border: "border-pink-200",    header: "bg-pink-50 hover:bg-pink-100",       icon: "text-pink-500",    sub: "text-pink-600",    amount: "text-pink-700",    divide: "divide-pink-100"    },
] as const;

function vendorColor(vendorId: string) {
  const n = parseInt(vendorId, 10) || 0;
  return VENDOR_COLORS[n % VENDOR_COLORS.length];
}

/* ── Daily arrears section ─────────────────────────────────────────── */
function DailyArrearsSection({ routerId }: { routerId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const qk = ["daily-arrears-versement", routerId];
  const [payingKey, setPayingKey]   = useState<string | null>(null);
  const [payAmount, setPayAmount]   = useState<string>("");
  const [payLoading, setPayLoading] = useState(false);
  const [expanded, setExpanded]     = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery<DailyArrearsResponse>({
    queryKey: qk,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ date: tomorrowStr(), routerId: String(routerId) });
      const res = await fetch(`${BASE}/api/vendors/daily-arrears?${params}`, { signal });
      if (!res.ok) return { arrears: {} };
      return res.json();
    },
    staleTime: 30_000,
  });

  const vendorInfo = data?.vendorInfo ?? {};
  const arrears = data?.arrears ?? {};

  const vendorIds = Object.keys(arrears).sort((a, b) => {
    const nameA = vendorInfo[a]?.name ?? a;
    const nameB = vendorInfo[b]?.name ?? b;
    return nameA.localeCompare(nameB);
  });

  const totalRemaining = useMemo(() =>
    Object.values(arrears).flat().reduce((s, e) => s + e.remaining, 0),
    [arrears]
  );

  const submitPayment = useCallback(async (vendorId: string, date: string, amount: number, underlying?: DailyArrearEntry[]) => {
    if (!amount || amount <= 0) return;
    setPayLoading(true);
    try {
      // If consolidated entry: distribute payment across underlying days, oldest first
      if (underlying && underlying.length > 0) {
        const ordered = [...underlying].filter((e) => e.remaining > 0).sort((a, b) => a.date.localeCompare(b.date));
        let left = Math.round(amount);
        let applied = 0;
        let appliedDays = 0;
        let failure: string | null = null;
        for (const e of ordered) {
          if (left <= 0) break;
          const pay = Math.min(left, e.remaining);
          if (pay > 0) {
            const r = await fetch(`${BASE}/api/vendors/${vendorId}/daily-payments`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ routerId, date: e.date, amount: pay }),
            });
            if (!r.ok) { failure = await r.text(); break; }
            applied += pay;
            appliedDays += 1;
            left -= pay;
          }
        }
        // Always invalidate if any sub-write succeeded so UI reflects partial application
        if (applied > 0) await invalidateAllPaymentQueries(queryClient, routerId);
        if (failure) {
          toast({
            title: applied > 0 ? "Versement partiellement appliqué" : "Erreur",
            description: applied > 0
              ? `${fmtAmount(applied)} FCFA appliqué · ${fmtAmount(Math.round(amount) - applied)} FCFA non appliqué : ${failure}`
              : failure,
            variant: "destructive",
          });
          return;
        }
        setPayingKey(null);
        setPayAmount("");
        toast({ title: "Versement enregistré", description: `${fmtAmount(applied)} FCFA réparti sur ${appliedDays} jour${appliedDays > 1 ? "s" : ""}` });
        return;
      }
      // Single-day payment
      const res = await fetch(`${BASE}/api/vendors/${vendorId}/daily-payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routerId, date, amount: Math.round(amount) }),
      });
      if (!res.ok) { toast({ title: "Erreur", description: await res.text(), variant: "destructive" }); return; }
      await invalidateAllPaymentQueries(queryClient, routerId);
      setPayingKey(null);
      setPayAmount("");
      toast({ title: "Versement enregistré", description: `${fmtAmount(Math.round(amount))} FCFA · ${fmtDateShort(date)}` });
    } finally {
      setPayLoading(false);
    }
  }, [routerId, queryClient, toast]);

  const solderVendorAll = useCallback(async (vendorId: string, entries: DailyArrearEntry[]) => {
    const toSolder = entries.filter((e) => e.remaining > 0);
    if (toSolder.length === 0) return;
    setPayLoading(true);
    try {
      await Promise.all(
        toSolder.map((e) =>
          fetch(`${BASE}/api/vendors/${vendorId}/daily-payments`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ routerId, date: e.date, amount: Math.round(e.remaining) }),
          })
        )
      );
      await invalidateAllPaymentQueries(queryClient, routerId);
      toast({ title: "Vendeur soldé", description: vendorInfo[vendorId]?.name ?? `Vendeur ${vendorId}` });
    } finally {
      setPayLoading(false);
    }
  }, [routerId, queryClient, toast, vendorInfo]);

  const toggleExpand = (vid: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(vid)) next.delete(vid);
      else next.add(vid);
      return next;
    });
  };

  if (isLoading) return (
    <div className="py-4 space-y-2">
      <Skeleton className="h-5 w-36 mx-auto" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-10/12" />
    </div>
  );

  if (vendorIds.length === 0) return (
    <div className="text-center py-6 text-xs text-gray-400 flex flex-col items-center gap-1">
      <CheckCircle2 className="h-6 w-6 text-emerald-400" />
      <span>Aucun arriéré journalier en attente</span>
    </div>
  );

  return (
    <div className="space-y-2">
      {/* Total header */}
      <div className="flex items-center justify-between text-xs text-gray-500 px-1">
        <span>{vendorIds.length} vendeur{vendorIds.length > 1 ? "s" : ""} avec arriérés</span>
        <span className="font-semibold text-orange-700">{fmtAmount(totalRemaining)} FCFA total</span>
      </div>

      {vendorIds.map((vid) => {
        const entries = arrears[vid] ?? [];
        const displayEntries = consolidateArrears(entries);
        const isConsolidated = entries.length >= 3;
        const vendorName = vendorInfo[vid]?.name ?? `Vendeur ${vid}`;
        const vendorTotal = entries.reduce((s, e) => s + e.remaining, 0);
        const isOpen = expanded.has(vid);
        const c = vendorColor(vid);

        return (
          <div key={vid} className={`border ${c.border} rounded-lg overflow-hidden`}>
            {/* Vendor header */}
            <div
              className={`flex items-center justify-between px-3 py-2.5 ${c.header} cursor-pointer transition-colors`}
              onClick={() => toggleExpand(vid)}
            >
              <div className="flex items-center gap-2 min-w-0">
                <AlertTriangle className={`h-3.5 w-3.5 ${c.icon} flex-shrink-0`} />
                <span className="font-semibold text-sm text-gray-800 truncate">{vendorName}</span>
                <span className={`text-[10px] ${c.sub} whitespace-nowrap`}>
                  {entries.length} jour{entries.length > 1 ? "s" : ""}{isConsolidated ? " (regroupés)" : ""}
                </span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={`font-bold ${c.amount} text-sm tabular-nums`}>{fmtAmount(vendorTotal)} FCFA</span>
                <button
                  className="text-[10px] px-2 py-0.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                  disabled={payLoading}
                  onClick={(e) => { e.stopPropagation(); solderVendorAll(vid, entries); }}
                >
                  Solder tout
                </button>
                {isOpen ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
              </div>
            </div>

            {/* Day entries */}
            {isOpen && (
              <div className={`divide-y ${c.divide}`}>
                {displayEntries.map((entry) => {
                  const pKey = `${vid}|${entry.date}`;
                  const isPaying = payingKey === pKey;
                  const underlying = entry.__underlying;
                  return (
                    <div key={entry.date} className="px-3 py-2 bg-white">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-gray-700">
                            {underlying ? `Arriérés cumulés (${underlying.length} jours, dernier : ${fmtDateFr(entry.date)})` : fmtDateFr(entry.date)}
                          </p>
                          {entry.paidAmount > 0 ? (
                            <p className="text-[10px] text-gray-400">
                              Ventes: {fmtAmount(entry.salesAmount)} · Versé: {fmtAmount(entry.paidAmount)} FCFA
                            </p>
                          ) : (
                            <p className="text-[10px] text-gray-400">Ventes: {fmtAmount(entry.salesAmount)} FCFA</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <span className={`text-xs font-bold ${c.amount} tabular-nums`}>{fmtAmount(entry.remaining)} FCFA</span>
                          {!isPaying && (
                            <>
                              <button
                                className="text-[10px] px-2 py-0.5 rounded bg-orange-600 text-white hover:bg-orange-700 transition-colors"
                                onClick={() => { setPayingKey(pKey); setPayAmount(String(entry.remaining)); }}
                              >
                                Verser
                              </button>
                              <button
                                className="text-[10px] px-2 py-0.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                                disabled={payLoading}
                                onClick={() => submitPayment(vid, entry.date, entry.remaining, underlying)}
                              >
                                Solder
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {isPaying && (
                        <div className="mt-2 flex items-center gap-1.5 pl-2">
                          <Input
                            type="number" min={1} max={entry.remaining}
                            className="h-7 w-28 text-xs"
                            value={payAmount}
                            onChange={(e) => setPayAmount(e.target.value)}
                            placeholder="Montant"
                          />
                          <span className="text-[10px] text-gray-500">FCFA</span>
                          <button
                            className="text-[10px] px-2 py-0.5 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                            disabled={payLoading || !payAmount || Number(payAmount) <= 0}
                            onClick={() => submitPayment(vid, entry.date, Number(payAmount), underlying)}
                          >
                            {payLoading ? "…" : "Confirmer"}
                          </button>
                          <button
                            className="text-[10px] px-2 py-0.5 rounded bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors"
                            onClick={() => { setPayingKey(null); setPayAmount(""); }}
                          >
                            Annuler
                          </button>
                        </div>
                      )}

                      {/* Existing day payments */}
                      {entry.payments.length > 0 && (
                        <div className="mt-1.5 space-y-1 pl-2">
                          {entry.payments.map((p) => (
                            <div key={p.id} className="flex items-center gap-1.5 text-[10px] text-gray-400">
                              <CheckCircle2 className="h-3 w-3 text-emerald-400 flex-shrink-0" />
                              <span>{fmtAmount(p.amount)} FCFA versé</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Main page ───────────────────────────────────────────────────────── */
const MAX_WEEK_OFFSET = 4;

export default function VendorPayments() {
  const { selectedRouterId } = useRouterContext();
  const qc = useQueryClient();
  const [weekOffset, setWeekOffset] = useState(0); // 0 = last week, 1 = 2 weeks ago, ...

  const curMon  = currentMonday();
  const lastMon = mondayNWeeksAgo(curMon, 1);

  const carouselWeekStart = useMemo(
    () => mondayNWeeksAgo(lastMon, weekOffset),
    [lastMon, weekOffset]
  );

  const carouselLabel = useMemo(() => {
    if (weekOffset === 0) return "Semaine dernière";
    if (weekOffset === 1) return "Il y a 2 semaines";
    return `Il y a ${weekOffset + 1} semaines`;
  }, [weekOffset]);


  if (!selectedRouterId) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-12 text-center text-gray-400">
            <Users className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p>Sélectionner un routeur pour gérer les versements.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 max-w-3xl mx-auto">
      <div className="flex items-center gap-2">
        <Wallet className="h-5 w-5 text-blue-500" />
        <h1 className="text-lg font-bold text-gray-900">Versements vendeurs</h1>
      </div>

      {/* Semaine en cours */}
      <WeekCard
        label="Semaine en cours"
        weekStart={curMon}
        routerId={selectedRouterId}
        colorClass="bg-blue-500"
        queryClient={qc}
      />

      {/* Semaine(s) précédente(s) — carousel */}
      <div>
        <WeekCard
          label={carouselLabel}
          weekStart={carouselWeekStart}
          routerId={selectedRouterId}
          colorClass={weekOffset === 0 ? "bg-gray-400" : "bg-amber-400"}
          queryClient={qc}
          onPrev={() => setWeekOffset((o) => Math.min(o + 1, MAX_WEEK_OFFSET))}
          onNext={() => setWeekOffset((o) => Math.max(o - 1, 0))}
          canGoPrev={weekOffset < MAX_WEEK_OFFSET}
          canGoNext={weekOffset > 0}
        />
        {weekOffset > 0 && (
          <p className="text-[10px] text-center text-gray-400 mt-1">
            Faites défiler ou utilisez ‹ › pour naviguer entre les semaines
          </p>
        )}
        {weekOffset === 0 && (
          <p className="text-[10px] text-center text-gray-400 mt-1">
            ‹ Défiler ou appuyer sur la flèche gauche pour voir les semaines antérieures
          </p>
        )}
      </div>

      {/* Versements journaliers de la semaine en cours */}
      <Card className="shadow-sm border-emerald-100">
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            Versements journaliers — semaine en cours
          </CardTitle>
          <p className="text-xs text-gray-400">Cliquez sur 🗑 pour corriger une erreur de saisie</p>
        </CardHeader>
        <CardContent className="pt-1 pb-4">
          <WeeklyDailyPaymentsSection routerId={selectedRouterId} />
        </CardContent>
      </Card>

      {/* Arriérés journaliers masqués à la demande utilisateur */}
    </div>
  );
}
