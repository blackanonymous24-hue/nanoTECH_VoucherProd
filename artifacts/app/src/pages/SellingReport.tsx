import { useState, useMemo, useRef, useDeferredValue } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouterContext } from "@/contexts/RouterContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FileDown, Search, RotateCcw, Receipt, Loader2, AlertCircle,
} from "lucide-react";
import { foldText } from "@/lib/text";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const ALL = "_all"; // sentinel for "no filter" in Select (empty string not allowed)

const MONTH_NAMES_FR = [
  "Janvier","Février","Mars","Avril","Mai","Juin",
  "Juillet","Août","Septembre","Octobre","Novembre","Décembre",
];

interface SaleEntry {
  date: string;
  time: string;
  username: string;
  price: number;
  ip: string;
  mac: string;
  validity: string;
  label: string;
  batch: string;
}

function fmtAmount(n: number) {
  return n.toLocaleString("fr-FR");
}

function exportCSV(entries: SaleEntry[], filename: string) {
  const header = ["#","Date","Heure","Utilisateur","Profil","Lot","Prix (FCFA)","IP","MAC","Validité"];
  const rows = entries.map((e, i) => [
    i + 1, e.date, e.time, e.username, e.label, e.batch, e.price, e.ip, e.mac, e.validity,
  ]);
  const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}

export default function SellingReport() {
  const { selectedRouterId } = useRouterContext();
  const now = new Date();

  const [filterDay,   setFilterDay]   = useState<string>(ALL);
  const [filterMonth, setFilterMonth] = useState<string>(String(now.getMonth() + 1));
  const [filterYear,  setFilterYear]  = useState<string>(String(now.getFullYear()));
  const [search,      setSearch]      = useState("");
  const deferredSearch = useDeferredValue(search);
  const [applied,     setApplied]     = useState<{ day: string; month: string; year: string }>({
    day: ALL, month: String(now.getMonth() + 1), year: String(now.getFullYear()),
  });

  const isAll = applied.month === ALL && applied.year === ALL;

  // Convert ALL sentinel → empty string for API params
  const appliedDay   = applied.day   === ALL ? "" : applied.day;
  const appliedMonth = applied.month === ALL ? "" : applied.month;
  const appliedYear  = applied.year  === ALL ? "" : applied.year;

  const queryKey = useMemo(() => [
    "selling-report", selectedRouterId, appliedDay, appliedMonth, appliedYear,
  ], [selectedRouterId, appliedDay, appliedMonth, appliedYear]);

  const { data, isLoading, isError, error } = useQuery<SaleEntry[]>({
    queryKey,
    queryFn: async ({ signal }) => {
      if (!selectedRouterId) return [];
      const params = new URLSearchParams();
      if (appliedYear)  params.set("year",  appliedYear);
      if (appliedMonth) params.set("month", appliedMonth);
      if (appliedDay)   params.set("day",   appliedDay);
      const res = await fetch(`${BASE}/api/routers/${selectedRouterId}/sales-report?${params}`, { signal });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: !!selectedRouterId,
    staleTime: 30_000,
  });

  const entries = data ?? [];

  const filtered = useMemo(() => {
    if (!deferredSearch.trim()) return entries;
    const q = foldText(deferredSearch);
    return entries.filter(
      (e) =>
        foldText(e.username).includes(q) ||
        foldText(e.label).includes(q) ||
        foldText(e.batch).includes(q) ||
        foldText(e.date).includes(q),
    );
  }, [entries, deferredSearch]);

  const totalAmount = useMemo(() => filtered.reduce((s, e) => s + e.price, 0), [filtered]);
  const tableRows = useMemo(
    () => filtered.map((e, i) => (
      <tr
        key={`${e.date}-${e.time}-${e.username}`}
        className="border-b border-gray-50 hover:bg-gray-50 transition-colors"
      >
        <td className="px-3 py-2 text-gray-400 tabular-nums">{i + 1}</td>
        <td className="px-3 py-2 font-mono text-gray-600">{e.date}</td>
        <td className="px-3 py-2 font-mono text-gray-500">{e.time}</td>
        <td className="px-3 py-2 font-medium text-gray-800">{e.username}</td>
        <td className="px-3 py-2 text-gray-600">{e.label || "—"}</td>
        <td className="px-3 py-2 text-gray-500">{e.batch || "—"}</td>
        <td className="px-3 py-2 text-right font-semibold text-gray-800 tabular-nums">
          {fmtAmount(e.price)}
        </td>
      </tr>
    )),
    [filtered],
  );

  const yearOptions = useMemo(() => {
    const years = [];
    for (let y = now.getFullYear(); y >= 2018; y--) years.push(String(y));
    return years;
  }, []);

  function applyFilter() {
    setApplied({ day: filterDay, month: filterMonth, year: filterYear });
    setSearch("");
  }

  function showAll() {
    setFilterDay(ALL); setFilterMonth(ALL); setFilterYear(ALL);
    setApplied({ day: ALL, month: ALL, year: ALL });
    setSearch("");
  }

  const reportLabel = useMemo(() => {
    if (isAll) return "Tout l'historique";
    const mo = appliedMonth ? MONTH_NAMES_FR[Number(appliedMonth) - 1] : "";
    const yr = appliedYear  ?? "";
    const dy = appliedDay   ? `${appliedDay} ` : "";
    return `${dy}${mo} ${yr}`.trim();
  }, [isAll, appliedDay, appliedMonth, appliedYear]);

  const csvFilename = `rapport-ventes-${reportLabel.replace(/\s+/g, "-")}.csv`;

  if (!selectedRouterId) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-12 text-center text-gray-400">
            <Receipt className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p>Sélectionner un routeur pour voir le rapport de ventes.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <Card>
        <CardHeader className="pb-3 border-b border-gray-100">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Receipt className="h-5 w-5 text-emerald-500" />
              Rapport de ventes
              <Badge variant="outline" className="text-xs font-normal">
                {reportLabel}
              </Badge>
            </CardTitle>
            <div className="flex items-center gap-2">
              {isLoading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
              {!isLoading && (
                <span className="text-xs text-gray-500 tabular-nums">
                  {filtered.length} vente{filtered.length !== 1 ? "s" : ""} — <span className="font-semibold text-gray-700">{fmtAmount(totalAmount)} FCFA</span>
                </span>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-4 space-y-3">
          {/* ── Filter bar ─────────────────────────────────────── */}
          <div className="form-shell flex flex-wrap items-end gap-2">
            {/* Day */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Jour</span>
              <Select value={filterDay} onValueChange={setFilterDay}>
                <SelectTrigger className="h-8 w-[70px] text-xs">
                  <SelectValue placeholder="Tous" />
                </SelectTrigger>
                <SelectContent className="max-h-60 overflow-y-auto data-[state=open]:animate-none data-[state=closed]:animate-none">
                  <SelectItem value={ALL}>Tous</SelectItem>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <SelectItem key={d} value={String(d)}>{String(d).padStart(2, "0")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Month */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Mois</span>
              <Select value={filterMonth} onValueChange={setFilterMonth}>
                <SelectTrigger className="h-8 w-[130px] text-xs">
                  <SelectValue placeholder="Tous" />
                </SelectTrigger>
                <SelectContent className="max-h-60 overflow-y-auto data-[state=open]:animate-none data-[state=closed]:animate-none">
                  <SelectItem value={ALL}>Tous</SelectItem>
                  {MONTH_NAMES_FR.map((name, i) => (
                    <SelectItem key={i + 1} value={String(i + 1)}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Year */}
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Année</span>
              <Select value={filterYear} onValueChange={setFilterYear}>
                <SelectTrigger className="h-8 w-[90px] text-xs">
                  <SelectValue placeholder="Toutes" />
                </SelectTrigger>
                <SelectContent className="max-h-60 overflow-y-auto data-[state=open]:animate-none data-[state=closed]:animate-none">
                  <SelectItem value={ALL}>Toutes</SelectItem>
                  {yearOptions.map((y) => (
                    <SelectItem key={y} value={y}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={applyFilter}>
              <Search className="h-3.5 w-3.5" /> Filtrer
            </Button>
            <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={showAll}>
              <RotateCcw className="h-3.5 w-3.5" /> Tout
            </Button>
            <Button
              size="sm" variant="outline"
              className="h-8 gap-1.5 text-xs ml-auto"
              onClick={() => exportCSV(filtered, csvFilename)}
              disabled={filtered.length === 0}
            >
              <FileDown className="h-3.5 w-3.5" /> CSV
            </Button>
          </div>

          {/* ── Search ─────────────────────────────────────────── */}
          <Input
            placeholder="Rechercher utilisateur, profil, lot…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-xs max-w-xs"
          />

          {/* ── Error ──────────────────────────────────────────── */}
          {isError && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {(error as Error)?.message ?? "Erreur de connexion MikroTik"}
            </div>
          )}

          {/* ── Loading ────────────────────────────────────────── */}
          {isLoading && (
            <div className="py-6 space-y-2">
              <Skeleton className="h-6 w-56 mx-auto" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-11/12" />
            </div>
          )}

          {/* ── Table ──────────────────────────────────────────── */}
          {!isLoading && (
            <div className="overflow-x-auto rounded-lg border border-gray-100">
              <table className="w-full min-w-[680px] text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-3 py-2 text-left text-gray-500 font-medium w-10">#</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium">Date</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium">Heure</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium">Utilisateur</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium">Profil</th>
                    <th className="px-3 py-2 text-left text-gray-500 font-medium">Lot</th>
                    <th className="px-3 py-2 text-right text-gray-500 font-medium">Prix (FCFA)</th>
                  </tr>
                  {/* Running total header */}
                  <tr className="bg-emerald-50 border-b border-emerald-100">
                    <th colSpan={5} className="px-3 py-1.5 text-left text-emerald-700 font-medium text-xs">
                      {filtered.length} ticket{filtered.length !== 1 ? "s" : ""}
                    </th>
                    <th className="px-3 py-1.5 text-right text-emerald-700 font-bold text-xs" colSpan={2}>
                      Total : {fmtAmount(totalAmount)} FCFA
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-8 text-center text-gray-400">
                        Aucune vente trouvée
                      </td>
                    </tr>
                  ) : tableRows}
                </tbody>
                {filtered.length > 0 && (
                  <tfoot>
                    <tr className="bg-gray-50 border-t border-gray-200">
                      <td colSpan={5} className="px-3 py-2 text-xs text-gray-500 font-medium">
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
