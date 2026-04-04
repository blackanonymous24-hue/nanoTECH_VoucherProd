import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouterContext } from "@/contexts/RouterContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Wallet, Users, Loader2, AlertCircle, CheckCircle2, Trash2, Plus, ChevronDown, ChevronUp,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

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

/** Returns YYYY-MM-DD of Monday of the current week (UTC) */
function currentMonday(): string {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(now);
  mon.setUTCDate(now.getUTCDate() + diff);
  return mon.toISOString().slice(0, 10);
}

/** Returns YYYY-MM-DD of Monday of last week */
function lastMonday(): string {
  const mon = new Date(currentMonday() + "T00:00:00Z");
  mon.setUTCDate(mon.getUTCDate() - 7);
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
}

interface VendorWeekEntry {
  vendorId: number;
  vendorName: string;
  count: number;
  amount: number;
  commission: number;
  commissionRate: number;
  totalPaid: number;
  remaining: number;
  payments: PaymentEntry[];
}

interface WeeklySummaryResponse {
  weekStart: string;
  vendors: VendorWeekEntry[];
}

/* ── Single vendor row with payment form ─────────────────────────────── */
function VendorRow({
  vendor,
  routerId,
  weekStart,
  onMutated,
}: {
  vendor: VendorWeekEntry;
  routerId: number;
  weekStart: string;
  onMutated: () => void;
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

  const deletePayment = async (id: number) => {
    const res = await fetch(`${BASE}/api/vendors/payments/${id}`, { method: "DELETE" });
    if (!res.ok) { toast({ title: "Erreur", variant: "destructive" }); return; }
    onMutated();
    toast({ title: "Versement annulé" });
  };

  return (
    <div className="border border-gray-100 rounded-lg overflow-hidden">
      {/* Main row */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-white hover:bg-gray-50 transition-colors">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-gray-800">{vendor.vendorName}</span>
            {isFullyPaid && (
              <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                <CheckCircle2 className="h-3 w-3" /> Soldé
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-[11px] text-gray-500">
            <span>{vendor.count} ticket{vendor.count !== 1 ? "s" : ""}</span>
            <span>Ventes : <span className="font-medium text-gray-700">{fmtAmount(vendor.amount)} FCFA</span></span>
            {vendor.commission > 0 && (
              <span>Commission : <span className="font-medium text-violet-600">−{fmtAmount(vendor.commission)} FCFA ({vendor.commissionRate}%)</span></span>
            )}
            {vendor.totalPaid > 0 && (
              <span>Versé : <span className="font-medium text-emerald-700">{fmtAmount(vendor.totalPaid)} FCFA</span></span>
            )}
            {vendor.remaining > 0 && (
              <span>Reste : <span className="font-semibold text-orange-600">{fmtAmount(vendor.remaining)} FCFA</span></span>
            )}
          </div>
        </div>

        <Button
          size="sm" variant="outline"
          className="h-7 gap-1 text-xs flex-shrink-0"
          onClick={() => setOpen((v) => !v)}
        >
          <Plus className="h-3.5 w-3.5" />
          Verser
          {open ? <ChevronUp className="h-3 w-3 ml-0.5" /> : <ChevronDown className="h-3 w-3 ml-0.5" />}
        </Button>
      </div>

      {/* Expandable section */}
      {open && (
        <div className="border-t border-gray-100 bg-gray-50 px-3 py-3 space-y-3">
          {/* Add payment form */}
          <div className="flex gap-2 items-end flex-wrap">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wide">Montant (FCFA)</span>
              <Input
                type="number"
                min={1}
                placeholder="Ex: 33900"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-8 text-xs w-36"
                onKeyDown={(e) => e.key === "Enter" && addPayment()}
              />
            </div>
            <div className="flex flex-col gap-1 flex-1 min-w-28">
              <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wide">Note (optionnel)</span>
              <Input
                placeholder="Référence, commentaire…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="h-8 text-xs"
                onKeyDown={(e) => e.key === "Enter" && addPayment()}
              />
            </div>
            <Button
              size="sm" className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700"
              onClick={addPayment}
              disabled={!amount}
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Enregistrer
            </Button>
            {vendor.remaining > 0 && (
              <Button
                size="sm" variant="outline"
                className="h-8 text-xs gap-1"
                onClick={() => setAmount(String(vendor.remaining))}
              >
                Tout verser ({fmtAmount(vendor.remaining)})
              </Button>
            )}
          </div>

          {/* Existing payments */}
          {vendor.payments.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Versements enregistrés</p>
              {vendor.payments.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-2 bg-white border border-gray-100 rounded px-2.5 py-1.5 text-xs"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                  <span className="font-semibold text-gray-800 tabular-nums">{fmtAmount(p.amount)} FCFA</span>
                  <span className="text-gray-400">
                    {new Date(p.paidAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
                  </span>
                  {p.note && <span className="text-gray-500 italic truncate flex-1">— {p.note}</span>}
                  <button
                    className="ml-auto text-gray-300 hover:text-red-500 transition-colors flex-shrink-0"
                    onClick={() => deletePayment(p.id)}
                    title="Annuler ce versement"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
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
}: {
  label: string;
  weekStart: string;
  routerId: number;
  colorClass: string;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const qk = ["weekly-summary", routerId, weekStart];

  const { data, isLoading, isError } = useQuery<WeeklySummaryResponse>({
    queryKey: qk,
    queryFn: async () => {
      const params = new URLSearchParams({ routerId: String(routerId), weekStart });
      const res = await fetch(`${BASE}/api/vendors/weekly-summary?${params}`);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    staleTime: 30_000,
  });

  const onMutated = () => queryClient.invalidateQueries({ queryKey: qk });

  const grandSales      = useMemo(() => (data?.vendors ?? []).reduce((s, v) => s + v.amount, 0), [data]);
  const grandCommission = useMemo(() => (data?.vendors ?? []).reduce((s, v) => s + v.commission, 0), [data]);
  const grandPaid       = useMemo(() => (data?.vendors ?? []).reduce((s, v) => s + v.totalPaid, 0), [data]);
  const grandLeft       = useMemo(() => (data?.vendors ?? []).reduce((s, v) => s + v.remaining, 0), [data]);

  return (
    <Card className="shadow-sm border-gray-100">
      <CardHeader className="pb-2 pt-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${colorClass}`} />
            {label}
            <span className="text-gray-400 font-normal text-xs">{fmtDateFr(weekStart)}</span>
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
          <div className="flex items-center justify-center py-8 gap-2 text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-xs">Chargement…</span>
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
          <VendorRow
            key={v.vendorId}
            vendor={v}
            routerId={routerId}
            weekStart={weekStart}
            onMutated={onMutated}
          />
        ))}
      </CardContent>
    </Card>
  );
}

/* ── Main page ───────────────────────────────────────────────────────── */
export default function VendorPayments() {
  const { selectedRouterId } = useRouterContext();
  const qc = useQueryClient();

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

  const curMon  = currentMonday();
  const lastMon = lastMonday();

  return (
    <div className="p-6 space-y-5 max-w-3xl mx-auto">
      <div className="flex items-center gap-2">
        <Wallet className="h-5 w-5 text-blue-500" />
        <h1 className="text-lg font-bold text-gray-900">Versements vendeurs</h1>
      </div>

      <WeekCard
        label="Semaine en cours"
        weekStart={curMon}
        routerId={selectedRouterId}
        colorClass="bg-blue-500"
        queryClient={qc}
      />
      <WeekCard
        label="Semaine dernière"
        weekStart={lastMon}
        routerId={selectedRouterId}
        colorClass="bg-gray-400"
        queryClient={qc}
      />
    </div>
  );
}
