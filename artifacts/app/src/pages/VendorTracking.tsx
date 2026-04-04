import { useState, useMemo, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouterContext } from "@/contexts/RouterContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Printer, Search, RotateCcw, Users, Loader2, AlertCircle, CalendarDays, ImageDown,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const MONTH_NAMES_FR = [
  "Janvier","Février","Mars","Avril","Mai","Juin",
  "Juillet","Août","Septembre","Octobre","Novembre","Décembre",
];

function fmtAmount(n: number) {
  if (n === 0) return "0";
  return n.toLocaleString("fr-FR");
}

/** YYYY-MM-DD of yesterday (local time) */
function yesterdayLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function fmtDateFr(iso: string): string {
  const [y, m, day] = iso.split("-");
  return `${day} ${MONTH_NAMES_FR[parseInt(m, 10) - 1]} ${y}`;
}

interface VoucherEntry {
  id: number;
  vendorId: number | null;
  vendorName: string;
  username: string;
  profileName: string;
  amount: number;
  usedAt: string | null;
  date: string | null;
  time: string | null;
}

interface VendorSummaryEntry {
  vendorId: number | null;
  vendorName: string;
  count: number;
  amount: number;
}

interface DailyTrackingResponse {
  date: string;
  summary: VendorSummaryEntry[];
  vouchers: VoucherEntry[];
  weekSummary: VendorSummaryEntry[];
}

/** Returns "Lundi dd Mmmm yyyy – Aujourd'hui" label for current week */
function currentWeekLabel(): string {
  const now  = new Date();
  const day  = now.getDay(); // 0=Sun
  const diff = (day === 0 ? -6 : 1) - day; // offset to Monday
  const mon  = new Date(now);
  mon.setDate(now.getDate() + diff);
  const fmt  = (d: Date) => `${String(d.getDate()).padStart(2,"0")} ${MONTH_NAMES_FR[d.getMonth()]} ${d.getFullYear()}`;
  return `${fmt(mon)} – ${fmt(now)}`;
}

/* ── Print helper ────────────────────────────────────────────── */
function openPrintWindow(data: DailyTrackingResponse, search: string) {
  const dateFr = fmtDateFr(data.date);
  const vouchers = search.trim()
    ? data.vouchers.filter(
        (v) =>
          v.username.toLowerCase().includes(search.toLowerCase()) ||
          v.profileName.toLowerCase().includes(search.toLowerCase()) ||
          v.vendorName.toLowerCase().includes(search.toLowerCase()),
      )
    : data.vouchers;

  const grandTotal  = data.summary.reduce((s, r) => s + r.amount, 0);
  const grandCount  = data.summary.reduce((s, r) => s + r.count,  0);

  const weekTotal  = (data.weekSummary ?? []).reduce((s, r) => s + r.amount, 0);
  const weekCount  = (data.weekSummary ?? []).reduce((s, r) => s + r.count,  0);

  // Only vendors that actually sold something on that day
  const activeSummary = data.summary.filter((s) => s.count > 0);

  const summaryRows = activeSummary
    .map(
      (s, i) => `<tr>
        <td>${i + 1}</td>
        <td>${s.vendorName}</td>
        <td style="text-align:center">${s.count}</td>
        <td style="text-align:right">${fmtAmount(s.amount)}</td>
      </tr>`,
    )
    .join("");

  const weekRows = (data.weekSummary ?? [])
    .map(
      (s, i) => `<tr>
        <td>${i + 1}</td>
        <td>${s.vendorName}</td>
        <td style="text-align:center">${s.count}</td>
        <td style="text-align:right">${fmtAmount(s.amount)}</td>
      </tr>`,
    )
    .join("");

  const detailRows = vouchers
    .map(
      (v, i) => `<tr>
        <td>${i + 1}</td>
        <td>${v.time ?? "—"}</td>
        <td>${v.username}</td>
        <td>${v.profileName || "—"}</td>
        <td>${v.vendorName}</td>
        <td style="text-align:right">${fmtAmount(v.amount)}</td>
      </tr>`,
    )
    .join("");

  const weekSection = weekRows ? `
<h3>Résumé semaine en cours &nbsp;<small style="font-weight:normal;color:#555">(${currentWeekLabel()})</small></h3>
<table>
  <thead><tr>
    <th style="width:30px">N°</th>
    <th>Vendeur</th>
    <th class="center" style="width:80px">Tickets</th>
    <th class="right"  style="width:110px">Total (FCFA)</th>
  </tr></thead>
  <tbody>${weekRows}</tbody>
  <tfoot><tr>
    <td colspan="2" style="text-align:right">TOTAL SEMAINE</td>
    <td class="center">${weekCount}</td>
    <td class="right">${fmtAmount(weekTotal)}</td>
  </tr></tfoot>
</table>` : "";

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Suivi vendeurs — ${dateFr}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 11px; margin: 0; padding: 8mm; }
  h2 { margin: 0 0 2px; font-size: 14px; }
  h3 { margin: 10px 0 4px; font-size: 12px; border-bottom: 1px solid #000; padding-bottom: 2px; }
  p  { margin: 0 0 8px; font-size: 10px; color: #555; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th, td { border: 1px solid #000; padding: 4px 6px; }
  th { background: #f0f0f0; font-weight: bold; text-align: left; }
  tfoot td { font-weight: bold; background: #e8e8e8; }
  .right { text-align: right; }
  .center { text-align: center; }
  @page { size: A4; margin: 10mm 7mm; }
  @media print {
    tr { page-break-inside: avoid; }
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }
  }
</style>
</head><body>
<h2>Suivi des ventes par vendeur</h2>
<p>Date : ${dateFr} &nbsp;|&nbsp; Généré le ${new Date().toLocaleString("fr-FR")}</p>

<h3>Résumé du jour — ${dateFr}</h3>
<table>
  <thead><tr>
    <th style="width:30px">N°</th>
    <th>Vendeur</th>
    <th class="center" style="width:80px">Tickets vendus</th>
    <th class="right" style="width:110px">Total (FCFA)</th>
  </tr></thead>
  <tbody>${summaryRows}</tbody>
  <tfoot><tr>
    <td colspan="2" style="text-align:right">TOTAL JOUR</td>
    <td class="center">${grandCount}</td>
    <td class="right">${fmtAmount(grandTotal)}</td>
  </tr></tfoot>
</table>

${weekSection}

<h3>Détail des ventes (${vouchers.length} ticket${vouchers.length !== 1 ? "s" : ""})</h3>
<table>
  <thead><tr>
    <th style="width:30px">N°</th>
    <th style="width:50px">Heure</th>
    <th>Utilisateur</th>
    <th style="width:90px">Profil</th>
    <th>Vendeur</th>
    <th class="right" style="width:90px">Prix (FCFA)</th>
  </tr></thead>
  <tbody>${detailRows}</tbody>
  <tfoot><tr>
    <td colspan="4"></td>
    <td style="text-align:right">TOTAL</td>
    <td class="right">${fmtAmount(vouchers.reduce((s, v) => s + v.amount, 0))}</td>
  </tr></tfoot>
</table>
<script>window.onload = function() { window.print(); };</script>
</body></html>`;

  const win = window.open("", "_blank");
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}

/* ── Main page ───────────────────────────────────────────────── */
export default function VendorTracking() {
  const { selectedRouterId } = useRouterContext();

  const [date, setDate]       = useState<string>(yesterdayLocal());
  const [applied, setApplied] = useState<string>(yesterdayLocal());
  const [search, setSearch]   = useState("");
  const [saving, setSaving]   = useState(false);

  const summaryRef = useRef<HTMLDivElement>(null);

  const saveAsJpeg = useCallback(async () => {
    if (!summaryRef.current) return;
    setSaving(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(summaryRef.current, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        logging: false,
      });
      const link = document.createElement("a");
      link.download = `suivi-vendeurs-${applied}.jpeg`;
      link.href = canvas.toDataURL("image/jpeg", 0.92);
      link.click();
    } finally {
      setSaving(false);
    }
  }, [applied]);

  const { data, isLoading, isError, error } = useQuery<DailyTrackingResponse>({
    queryKey: ["vendor-tracking", selectedRouterId, applied],
    queryFn: async () => {
      if (!selectedRouterId) return { date: applied, summary: [], vouchers: [], weekSummary: [] };
      const params = new URLSearchParams({ date: applied, routerId: String(selectedRouterId) });
      const res = await fetch(`${BASE}/api/vendors/daily-tracking?${params}`);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: !!selectedRouterId,
    staleTime: 60_000,
  });

  const vouchers    = data?.vouchers    ?? [];
  const summary     = data?.summary     ?? [];
  const weekSummary = data?.weekSummary ?? [];

  const filtered = useMemo(() => {
    if (!search.trim()) return vouchers;
    const q = search.toLowerCase();
    return vouchers.filter(
      (v) =>
        v.username.toLowerCase().includes(q) ||
        v.profileName.toLowerCase().includes(q) ||
        v.vendorName.toLowerCase().includes(q),
    );
  }, [vouchers, search]);

  const totalAmount     = useMemo(() => filtered.reduce((s, v) => s + v.amount, 0), [filtered]);
  const grandTotal      = useMemo(() => summary.reduce((s, r) => s + r.amount, 0), [summary]);
  const grandCount      = useMemo(() => summary.reduce((s, r) => s + r.count, 0), [summary]);
  const activeSummary   = useMemo(() => summary.filter((s) => s.count > 0), [summary]);
  const weekTotal_amount = useMemo(() => weekSummary.reduce((s, r) => s + r.amount, 0), [weekSummary]);
  const weekTotal_count  = useMemo(() => weekSummary.reduce((s, r) => s + r.count,  0), [weekSummary]);

  if (!selectedRouterId) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-12 text-center text-gray-400">
            <Users className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p>Sélectionner un routeur pour voir le suivi des vendeurs.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const dateLabelFr = applied ? fmtDateFr(applied) : "—";

  return (
    <div className="p-4 space-y-4">
      <Card>
        <CardHeader className="pb-3 border-b border-gray-100">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-5 w-5 text-blue-500" />
              Suivi des vouchers par vendeur
            </CardTitle>
            <div className="flex items-center gap-2">
              {isLoading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
              {!isLoading && data && (
                <span className="text-xs text-gray-500 tabular-nums">
                  {grandCount} ticket{grandCount !== 1 ? "s" : ""} —{" "}
                  <span className="font-semibold text-gray-700">{fmtAmount(grandTotal)} FCFA</span>
                </span>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-4 space-y-3">
          {/* Filter bar */}
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Date</span>
              <div className="relative flex items-center">
                <CalendarDays className="absolute left-2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
                <input
                  type="date"
                  value={date}
                  max={yesterdayLocal()}
                  onChange={(e) => setDate(e.target.value)}
                  className="h-8 pl-7 pr-2 text-xs border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <Button
              size="sm" className="h-8 gap-1.5 text-xs"
              onClick={() => { setApplied(date); setSearch(""); }}
            >
              <Search className="h-3.5 w-3.5" /> Filtrer
            </Button>
            <Button
              size="sm" variant="outline" className="h-8 gap-1.5 text-xs"
              onClick={() => { const y = yesterdayLocal(); setDate(y); setApplied(y); setSearch(""); }}
            >
              <RotateCcw className="h-3.5 w-3.5" /> Hier
            </Button>

            <div className="ml-auto flex gap-2">
              <Button
                size="sm" variant="outline"
                className="h-8 w-8 p-0"
                disabled={!data || grandCount === 0 || saving}
                onClick={saveAsJpeg}
                title="Enregistrer résumé en image"
              >
                {saving
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <ImageDown className="h-3.5 w-3.5" />}
              </Button>
              <Button
                size="sm" variant="outline"
                className="h-8 gap-1.5 text-xs"
                disabled={!data || grandCount === 0}
                onClick={() => data && openPrintWindow(data, search)}
              >
                <Printer className="h-3.5 w-3.5" /> Imprimer le rapport
              </Button>
            </div>
          </div>

          {/* Search */}
          <Input
            placeholder="Rechercher vendeur, utilisateur, profil…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-xs max-w-xs"
          />

          {/* Error */}
          {isError && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {(error as Error)?.message ?? "Erreur de chargement"}
            </div>
          )}

          {/* Loading */}
          {isLoading && (
            <div className="flex items-center justify-center py-12 gap-2 text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Chargement…</span>
            </div>
          )}

          {/* ── Capture zone (summary + week) ─────────────────── */}
          <div ref={summaryRef} className="space-y-3 bg-white rounded-xl p-3">

          {/* Summary table */}
          {!isLoading && activeSummary.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-gray-100">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-3 py-2 text-left text-gray-500 font-medium w-10">#</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium">Vendeur</th>
                    <th className="px-3 py-2 text-center text-gray-500 font-medium w-28">Tickets vendus</th>
                    <th className="px-3 py-2 text-right text-gray-500 font-medium w-36">Total (FCFA)</th>
                  </tr>
                  <tr className="bg-blue-50 border-b border-blue-100">
                    <th colSpan={2} className="px-3 py-1.5 text-left text-blue-700 font-medium text-xs">
                      {activeSummary.length} vendeur{activeSummary.length !== 1 ? "s" : ""} — {dateLabelFr}
                    </th>
                    <th className="px-3 py-1.5 text-center text-blue-700 font-bold text-xs">
                      {grandCount}
                    </th>
                    <th className="px-3 py-1.5 text-right text-blue-700 font-bold text-xs">
                      {fmtAmount(grandTotal)} FCFA
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {activeSummary.map((s, i) => (
                    <tr key={s.vendorId ?? "none"} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="px-3 py-2 text-gray-400 tabular-nums">{i + 1}</td>
                      <td className="px-3 py-2 font-medium text-gray-800">{s.vendorName}</td>
                      <td className="px-3 py-2 text-center tabular-nums text-gray-700">{s.count}</td>
                      <td className="px-3 py-2 text-right font-semibold text-gray-800 tabular-nums">
                        {fmtAmount(s.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 border-t border-gray-200">
                    <td colSpan={2} className="px-3 py-2 text-xs text-gray-500 font-medium text-right">
                      Total
                    </td>
                    <td className="px-3 py-2 text-center text-sm font-bold text-blue-700 tabular-nums">
                      {grandCount}
                    </td>
                    <td className="px-3 py-2 text-right text-sm font-bold text-blue-700 tabular-nums">
                      {fmtAmount(grandTotal)} FCFA
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Week summary table */}
          {!isLoading && weekSummary.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-gray-100">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-3 py-2 text-left text-gray-500 font-medium w-10">#</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium">Vendeur</th>
                    <th className="px-3 py-2 text-center text-gray-500 font-medium w-28">Tickets</th>
                    <th className="px-3 py-2 text-right text-gray-500 font-medium w-36">Total (FCFA)</th>
                  </tr>
                  <tr className="bg-indigo-50 border-b border-indigo-100">
                    <th colSpan={2} className="px-3 py-1.5 text-left text-indigo-700 font-medium text-xs">
                      Semaine en cours — {currentWeekLabel()}
                    </th>
                    <th className="px-3 py-1.5 text-center text-indigo-700 font-bold text-xs">
                      {weekTotal_count}
                    </th>
                    <th className="px-3 py-1.5 text-right text-indigo-700 font-bold text-xs">
                      {fmtAmount(weekTotal_amount)} FCFA
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {weekSummary.map((s, i) => (
                    <tr key={`week-${s.vendorId ?? "none"}`} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="px-3 py-2 text-gray-400 tabular-nums">{i + 1}</td>
                      <td className="px-3 py-2 font-medium text-gray-800">{s.vendorName}</td>
                      <td className="px-3 py-2 text-center tabular-nums text-gray-700">{s.count}</td>
                      <td className="px-3 py-2 text-right font-semibold text-gray-800 tabular-nums">
                        {fmtAmount(s.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 border-t border-gray-200">
                    <td colSpan={2} className="px-3 py-2 text-xs text-gray-500 font-medium text-right">
                      Total semaine
                    </td>
                    <td className="px-3 py-2 text-center text-sm font-bold text-indigo-700 tabular-nums">
                      {weekTotal_count}
                    </td>
                    <td className="px-3 py-2 text-right text-sm font-bold text-indigo-700 tabular-nums">
                      {fmtAmount(weekTotal_amount)} FCFA
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          </div>{/* end capture zone */}

          {/* Detail table */}
          {!isLoading && (
            <div className="overflow-x-auto rounded-lg border border-gray-100">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-3 py-2 text-left text-gray-500 font-medium w-10">#</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">Heure</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium">Utilisateur</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium">Profil</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium">Vendeur</th>
                    <th className="px-3 py-2 text-right text-gray-500 font-medium">Prix (FCFA)</th>
                  </tr>
                  <tr className="bg-emerald-50 border-b border-emerald-100">
                    <th colSpan={4} className="px-3 py-1.5 text-left text-emerald-700 font-medium text-xs">
                      {filtered.length} ticket{filtered.length !== 1 ? "s" : ""}
                    </th>
                    <th colSpan={2} className="px-3 py-1.5 text-right text-emerald-700 font-bold text-xs">
                      Total : {fmtAmount(totalAmount)} FCFA
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-gray-400">
                        {vouchers.length === 0
                          ? "Aucune vente enregistrée pour cette date"
                          : "Aucun résultat pour cette recherche"}
                      </td>
                    </tr>
                  ) : (
                    filtered.map((v, i) => (
                      <tr
                        key={v.id}
                        className="border-b border-gray-50 hover:bg-gray-50 transition-colors"
                      >
                        <td className="px-3 py-2 text-gray-400 tabular-nums">{i + 1}</td>
                        <td className="px-3 py-2 font-mono text-gray-500">{v.time ?? "—"}</td>
                        <td className="px-3 py-2 font-medium text-gray-800">{v.username}</td>
                        <td className="px-3 py-2 text-gray-600">{v.profileName || "—"}</td>
                        <td className="px-3 py-2 text-gray-600">{v.vendorName}</td>
                        <td className="px-3 py-2 text-right font-semibold text-gray-800 tabular-nums">
                          {fmtAmount(v.amount)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {filtered.length > 0 && (
                  <tfoot>
                    <tr className="bg-gray-50 border-t border-gray-200">
                      <td colSpan={4} className="px-3 py-2 text-xs text-gray-500 font-medium">
                        Total — {filtered.length} ticket{filtered.length !== 1 ? "s" : ""}
                      </td>
                      <td colSpan={2} className="px-3 py-2 text-right text-sm font-bold text-emerald-700 tabular-nums">
                        {fmtAmount(totalAmount)} FCFA
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
