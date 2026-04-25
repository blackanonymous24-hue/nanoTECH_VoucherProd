import { useState, useEffect, useCallback, useRef } from "react";
import { printReport } from "@/lib/print";
import { useAuth } from "@/contexts/AuthContext";
import { useAppNavigate } from "@/hooks/use-app-navigate";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Wifi, LogOut, TrendingUp, ShoppingCart, Calendar, Ticket,
  User, RefreshCw, Clock, ChevronLeft, ChevronRight, Search, Banknote, Printer, LogIn,
  PackageOpen, Bell, Wallet, CheckCircle2, KeyRound, X, AlertTriangle,
} from "lucide-react";

const TOKEN_KEY = "vouchernet_vendor_token";

/* ── Module-level dashboard cache ──────────────────────────────────────
   Survives React re-renders and component unmount/remount within the same
   browser tab. Enables instant display (no spinner) when the user returns
   to the portal or the component re-mounts with the same token.          */
const _dc: {
  token: string | null;
  data: PortalData | null;
  versData: VersementData | null;
  arrearsData: DailyArrearsData | null;
} = { token: null, data: null, versData: null, arrearsData: null };
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type VendorInfo = { id: number; name: string; email: string | null; username: string | null };
type SalesStats = {
  todaySold: number; todayAmount: number;
  yesterdaySold: number; yesterdayAmount: number;
  weekSold: number; weekAmount: number;
  lastMonthSold: number; lastMonthAmount: number;
};
type ByProfile = { profileName: string; total: number; printed: number; used: number; soldToday: number; soldThisMonth: number };
type Voucher = {
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
};
type PortalData = {
  vendor: VendorInfo;
  hotspotName: string | null;
  totalVouchers: number;
  totalAvailable: number;
  totalPrinted: number;
  totalUsed: number;
  salesStats: SalesStats;
  byProfile: ByProfile[];
  recentSales: Voucher[];
  availableVouchers: Voucher[];
};
type ReportData = { date: string; total: number; revenue: number; vouchers: Voucher[] };
type VersementWeek = {
  weekStart: string;
  label: string;
  count: number;
  amount: number;
  commission: number;
  commissionRate: number;
  weeklyPaid?: number;       // lump-sum weekly payments only
  dailyPaid?: number;        // daily payments only
  weeklyExpected?: number;   // amount - commission - dailyPaid
  totalPaid: number;
  remaining: number;
  payments: { id: number; amount: number; paidAt: string; note: string | null }[];
};
type VersementData = { weeks: VersementWeek[] };
type DailyArrearsDay = { date: string; count: number; amount: number; paid: number; remaining: number };
type DailyArrearsData = { days: DailyArrearsDay[] };

/** Consolidated arrears: when >3 daily arrears, merge all but the 2 most recent into one line dated the most recent of the merged days. */
type ConsolidatableDailyArrearsDay = DailyArrearsDay & { __underlyingCount?: number };
function consolidateDailyArrears(days: DailyArrearsDay[]): ConsolidatableDailyArrearsDay[] {
  // Always return ascending (oldest first, most recent last)
  const asc = [...days].sort((a, b) => a.date.localeCompare(b.date));
  if (asc.length <= 3) return asc;
  const older = asc.slice(0, asc.length - 2);
  const recent = asc.slice(asc.length - 2);
  const merged: ConsolidatableDailyArrearsDay = {
    date: older[older.length - 1].date,
    count:     older.reduce((s, d) => s + d.count, 0),
    amount:    older.reduce((s, d) => s + d.amount, 0),
    paid:      older.reduce((s, d) => s + d.paid, 0),
    remaining: older.reduce((s, d) => s + d.remaining, 0),
    __underlyingCount: older.length,
  };
  return [merged, ...recent];
}
type PeriodSalesData = {
  period: string;
  label: string;
  total: number;
  revenue: number;
  byProfile: { profileName: string; count: number; revenue: number }[];
  vouchers: Voucher[];
};

function api(path: string, options?: RequestInit) {
  return fetch(`${BASE}/api${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
}

function fmt(date: string | null) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("fr-FR", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

const MONTHS = [
  "Janvier","Février","Mars","Avril","Mai","Juin",
  "Juillet","Août","Septembre","Octobre","Novembre","Décembre",
];

function fmtFcfa(n: number): string {
  if (n === 0) return "0";
  return n.toLocaleString("fr-FR");
}

function amountFontClass(formatted: string): string {
  const len = formatted.replace(/[\s\u00A0]/g, "").length;
  if (len <= 4)  return "text-xl";
  if (len <= 6)  return "text-lg";
  if (len <= 8)  return "text-base";
  return "text-sm";
}

function StatCard({
  label, value, icon: Icon, color, onClick, fcfa, sub,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  color: string;
  onClick?: () => void;
  fcfa?: boolean;
  sub?: number;
}) {
  const formatted = fcfa ? fmtFcfa(value) : String(value);
  const inner = (
    <CardContent className="p-3 flex items-center gap-2.5">
      <div className={`h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
        <Icon className="h-4 w-4 text-white" />
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <p className={`${fcfa ? amountFontClass(formatted) : "text-xl"} font-bold text-gray-900 tabular-nums leading-tight truncate`}>
          {formatted}{fcfa && <span className="text-[10px] font-medium text-gray-400 ml-0.5">F</span>}
        </p>
        {sub !== undefined && (
          <p className="text-[10px] text-gray-400 truncate leading-tight">{sub} ticket{sub !== 1 ? "s" : ""}</p>
        )}
        <p className="text-[10px] text-gray-500 truncate leading-tight">{label}</p>
      </div>
    </CardContent>
  );
  if (onClick) {
    return (
      <Card className="cursor-pointer hover:shadow-md hover:border-blue-300 transition-all active:scale-[0.98]" onClick={onClick}>
        {inner}
      </Card>
    );
  }
  return <Card>{inner}</Card>;
}

function LoginPage({ onLogin }: { onLogin: (token: string, vendor: VendorInfo) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await api("/vendor-portal/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Erreur de connexion"); return; }
      onLogin(data.token, data.vendor);
    } catch {
      setError("Impossible de contacter le serveur");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4 shadow-lg">
            <Wifi className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">nanoTECH Vouchers Bills</h1>
          <p className="text-sm text-gray-400 mt-1">Gestion Hotspot MikroTik</p>
        </div>

        <div className="bg-gray-900 rounded-2xl p-6 shadow-xl border border-gray-800">
          <h2 className="text-lg font-semibold text-white mb-5">Connexion</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label className="text-gray-300 text-sm">Identifiant</Label>
              <Input
                id="vp-username"
                className="mt-1 bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 focus:border-blue-500"
                placeholder="votre identifiant"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
                autoComplete="username"
              />
            </div>
            <div>
              <Label className="text-gray-300 text-sm">Mot de passe</Label>
              <Input
                id="vp-password"
                className="mt-1 bg-gray-800 border-gray-700 text-white placeholder:text-gray-500 focus:border-blue-500"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="bg-red-900/40 border border-red-700 rounded-lg px-3 py-2 text-sm text-red-300">
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white gap-2"
              disabled={loading}
            >
              <LogIn className="h-4 w-4" />
              {loading ? "Connexion..." : "Se connecter"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

function AvailableVouchersModal({ open, onClose, vouchers }: { open: boolean; onClose: () => void; vouchers: Voucher[] }) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ticket className="h-5 w-5 text-blue-600" />
            Tickets disponibles ({vouchers.length})
          </DialogTitle>
        </DialogHeader>
        <div className="overflow-y-auto flex-1 -mx-6 px-6">
          {vouchers.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">Aucun ticket disponible</p>
          ) : (
            <div className="space-y-2 pb-2">
              {vouchers.map((v) => (
                <div key={v.id} className="flex items-center justify-between py-3 px-3 bg-gray-50 rounded-lg gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-mono font-semibold text-gray-800">{v.username}</p>
                    <p className="text-xs text-gray-500">{v.profileName}{v.price ? ` — ${v.price} FCFA` : ""}</p>
                  </div>
                  <Badge variant="outline" className="border-green-300 text-green-600 bg-green-50 flex-shrink-0 text-xs">Non vendu</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DayReport({ token, day, month, year, onBack, hotspotName }: {
  token: string;
  day: string;
  month: string;
  year: string;
  onBack: () => void;
  hotspotName?: string | null;
}) {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [vSearch, setVSearch] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    setVSearch("");
    api(`/vendor-portal/me/report?day=${day}&month=${month}&year=${year}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? "Erreur");
        return res.json();
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token, day, month, year]);

  const dateLabel = data
    ? new Date(`${data.date}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : `${day.padStart(2,"0")}/${month.padStart(2,"0")}/${year}`;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 no-print">
        <Button size="sm" variant="ghost" onClick={onBack} className="gap-1.5">
          <ChevronLeft className="h-4 w-4" /> Retour
        </Button>
        <div className="h-5 w-px bg-gray-200" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-gray-900 capitalize">{dateLabel}</p>
          <p className="text-xs text-gray-500">Rapport de ventes</p>
        </div>
        {data && (
          <Button size="sm" variant="outline" onClick={() => printReport("Rapport de ventes")} className="gap-1.5">
            <Printer className="h-4 w-4" /> Imprimer
          </Button>
        )}
      </header>

      <main id="report-print-section" className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {loading && <div className="text-center py-12 text-gray-400">Chargement du rapport...</div>}
        {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">{error}</div>}

        {data && (() => {
          const byProfile = data.vouchers.reduce((acc, v) => {
            if (!acc[v.profileName]) acc[v.profileName] = { count: 0, revenue: 0 };
            acc[v.profileName].count++;
            acc[v.profileName].revenue += parseFloat(v.salePrice || v.price || "0") || 0;
            return acc;
          }, {} as Record<string, { count: number; revenue: number }>);
          return (
            <>
              {/* ── Écran ── */}
              <div className="no-print space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <Card>
                    <CardContent className="p-4 flex items-center gap-3">
                      <div className="h-10 w-10 rounded-lg bg-blue-500 flex items-center justify-center flex-shrink-0">
                        <ShoppingCart className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <p className="text-2xl font-bold text-gray-900">{data.total}</p>
                        <p className="text-xs text-gray-500">Vendus ce jour</p>
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 flex items-center gap-3">
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
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between mb-2">
                      <CardTitle className="text-base">Tickets vendus ({data.total})</CardTitle>
                      {data.vouchers.length > 0 && (
                        <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full tabular-nums">
                          {vSearch.trim()
                            ? `${data.vouchers.filter(v => `${v.username} ${v.macAddress ?? ""} ${v.saleIp ?? ""}`.toLowerCase().includes(vSearch.toLowerCase())).length}/${data.vouchers.length}`
                            : data.vouchers.length}
                        </span>
                      )}
                    </div>
                    {data.vouchers.length > 0 && (
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
                        <input
                          type="text"
                          placeholder="Rechercher user, MAC ou IP…"
                          value={vSearch}
                          onChange={(e) => setVSearch(e.target.value)}
                          className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 placeholder-gray-400"
                        />
                        {vSearch && (
                          <button
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            onClick={() => setVSearch("")}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </CardHeader>
                  <CardContent className="p-0">
                    {data.vouchers.length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-6 px-4">Aucune vente ce jour</p>
                    ) : (() => {
                      const vFiltered = vSearch.trim()
                        ? data.vouchers.filter(v => `${v.username} ${v.macAddress ?? ""} ${v.saleIp ?? ""}`.toLowerCase().includes(vSearch.toLowerCase()))
                        : data.vouchers;
                      return vFiltered.length === 0 ? (
                        <p className="text-sm text-gray-400 text-center py-6 px-4">Aucun résultat pour « {vSearch} »</p>
                      ) : (
                      <div className="max-h-80 overflow-x-auto overflow-y-auto scroll-card">
                        <table className="w-full min-w-[620px] text-xs border-collapse">
                          <thead>
                            <tr className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-900/80 backdrop-blur-sm border-b border-gray-200">
                              <th className="text-left px-3 py-2 font-semibold text-gray-500 uppercase tracking-wide text-[10px]">User</th>
                              <th className="text-right px-3 py-2 font-semibold text-gray-500 uppercase tracking-wide text-[10px]">Prix</th>
                              <th className="text-left px-3 py-2 font-semibold text-gray-500 uppercase tracking-wide text-[10px] hidden sm:table-cell">MAC</th>
                              <th className="text-left px-3 py-2 font-semibold text-gray-500 uppercase tracking-wide text-[10px] hidden md:table-cell">IP</th>
                              <th className="text-left px-3 py-2 font-semibold text-gray-500 uppercase tracking-wide text-[10px]">Date</th>
                              <th className="text-center px-3 py-2 font-semibold text-gray-500 uppercase tracking-wide text-[10px]">État</th>
                            </tr>
                          </thead>
                          <tbody>
                            {vFiltered.map((v, i) => {
                              const displayPrice = v.salePrice || v.price || "";
                              const dateObj = (() => {
                                const raw = v.usedAt || v.printedAt;
                                if (!raw) return null;
                                const d = new Date(raw);
                                const dy = String(d.getDate()).padStart(2, "0");
                                const hh = String(d.getHours()).padStart(2, "0");
                                const mn = String(d.getMinutes()).padStart(2, "0");
                                return { date: `${dy} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`, time: `${hh}:${mn}` };
                              })();
                              return (
                                <tr key={v.id} className={`transition-colors hover:bg-gray-50 ${i % 2 === 0 ? "" : "bg-gray-50/50"}`}>
                                  <td className="px-3 py-2 max-w-[110px]">
                                    <p className="font-mono font-semibold text-gray-800 truncate">{v.username}</p>
                                    <p className="text-[10px] text-gray-400 truncate">{v.profileName}</p>
                                  </td>
                                  <td className="px-3 py-2 text-right whitespace-nowrap">
                                    {displayPrice ? (
                                      <span className="font-semibold text-emerald-600 tabular-nums">{Number(displayPrice).toLocaleString("fr-FR")}<span className="text-[9px] text-gray-400 ml-0.5">FCFA</span></span>
                                    ) : <span className="text-gray-300">—</span>}
                                  </td>
                                  <td className="px-3 py-2 hidden sm:table-cell">
                                    <span className="font-mono text-[10px] text-gray-500">{v.macAddress || <span className="text-gray-300">—</span>}</span>
                                  </td>
                                  <td className="px-3 py-2 hidden md:table-cell">
                                    <span className="font-mono text-[10px] text-gray-500">{v.saleIp || <span className="text-gray-300">—</span>}</span>
                                  </td>
                                  <td className="px-3 py-2 whitespace-nowrap">
                                    {dateObj ? (
                                      <>
                                        <p className="text-gray-700">{dateObj.date}</p>
                                        <p className="text-[10px] text-gray-400 font-mono">{dateObj.time}</p>
                                      </>
                                    ) : <span className="text-gray-300">—</span>}
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-50 text-red-500 ring-1 ring-red-200 whitespace-nowrap">Vendu</span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      );
                    })()}
                  </CardContent>
                </Card>
              </div>

              {/* ── Impression ── */}
              <div className="print-only">
                <p className="report-print-title">{hotspotName || "nanoTECH Vouchers Bills"} — Rapport de ventes</p>
                <p className="report-print-meta">
                  {dateLabel} &nbsp;·&nbsp; Imprimé le {new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                </p>

                <p className="report-print-section-label">Résumé</p>
                <table className="report-print-table">
                  <thead>
                    <tr><th>Total tickets vendus</th><th>Chiffre d'affaires estimé</th></tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><strong>{data.total}</strong></td>
                      <td><strong>{data.revenue.toLocaleString("fr-FR")} FCFA</strong></td>
                    </tr>
                  </tbody>
                </table>

                {Object.keys(byProfile).length > 0 && (
                  <>
                    <p className="report-print-section-label">Par forfait</p>
                    <table className="report-print-table">
                      <thead>
                        <tr><th>Forfait</th><th>Tickets</th><th>Montant FCFA</th></tr>
                      </thead>
                      <tbody>
                        {Object.entries(byProfile).map(([name, s]) => (
                          <tr key={name}>
                            <td>{name}</td>
                            <td>{s.count}</td>
                            <td>{s.revenue.toLocaleString("fr-FR")}</td>
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
                  <thead>
                    <tr><th>#</th><th>Code</th><th>Forfait</th><th>Prix (FCFA)</th><th>Date / Heure</th></tr>
                  </thead>
                  <tbody>
                    {data.vouchers.map((v, i) => (
                      <tr key={v.id}>
                        <td>{i + 1}</td>
                        <td style={{ fontFamily: "monospace" }}>{v.username}</td>
                        <td>{v.profileName}</td>
                        <td>{(v.salePrice || v.price) ?? "—"}</td>
                        <td>{v.printedAt ? new Date(v.printedAt).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          );
        })()}
      </main>
    </div>
  );
}

function PeriodReport({ token, period, onBack, hotspotName, initialData }: {
  token: string;
  period: "today" | "yesterday" | "week" | "month";
  onBack: () => void;
  hotspotName?: string | null;
  initialData?: PeriodSalesData | null;
}) {
  const [data, setData] = useState<PeriodSalesData | null>(initialData ?? null);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState("");
  const [vSearch, setVSearch] = useState("");

  useEffect(() => {
    setVSearch("");
  }, [period]);

  useEffect(() => {
    // If we already have data from the prefetch cache, show it instantly.
    // A background refresh will happen on the next prefetch cycle (every 15 s).
    if (initialData) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    api(`/vendor-portal/me/period-sales?period=${period}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? "Erreur");
        return res.json();
      })
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token, period, initialData]);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 no-print">
        <Button size="sm" variant="ghost" onClick={onBack} className="gap-1.5">
          <ChevronLeft className="h-4 w-4" /> Retour
        </Button>
        <div className="h-5 w-px bg-gray-200" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-gray-900">{data?.label ?? "..."}</p>
          <p className="text-xs text-gray-500">Rapport de ventes</p>
        </div>
        {data && (
          <Button size="sm" variant="outline" onClick={() => printReport("Rapport de ventes")} className="gap-1.5">
            <Printer className="h-4 w-4" /> Imprimer
          </Button>
        )}
      </header>

      <main id="report-print-section" className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {loading && <div className="text-center py-12 text-gray-400">Chargement du rapport...</div>}
        {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">{error}</div>}

        {data && (
          <>
            {/* ── Écran ── */}
            <div className="no-print space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Card>
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-blue-500 flex items-center justify-center flex-shrink-0">
                      <ShoppingCart className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-gray-900">{data.total}</p>
                      <p className="text-xs text-gray-500">Tickets vendus</p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 flex items-center gap-3">
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
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">Par forfait</CardTitle></CardHeader>
                <CardContent>
                  {data.byProfile.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-4">Aucun voucher généré</p>
                  ) : (
                    <div className="space-y-2">
                      {[...data.byProfile].sort((a, b) => (parseFloat(String((a as any).price ?? "0").replace(/\s/g, "")) || 0) - (parseFloat(String((b as any).price ?? "0").replace(/\s/g, "")) || 0)).map((p) => (
                        <div key={p.profileName} className="flex items-center justify-between py-2 border-b last:border-0">
                          <span className="text-sm font-medium text-gray-700">{p.profileName}</span>
                          <div className="flex items-center gap-4 text-sm">
                            <span className="text-gray-500">{p.count} ticket{p.count > 1 ? "s" : ""}</span>
                            {Number(p.revenue) > 0 && <span className="font-semibold text-gray-800">{Number(p.revenue).toLocaleString("fr-FR")} FCFA</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between mb-2">
                    <CardTitle className="text-base">Tickets vendus ({data.total})</CardTitle>
                    {data.vouchers.length > 0 && (
                      <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full tabular-nums">
                        {vSearch.trim()
                          ? `${data.vouchers.filter(v => `${v.username} ${v.macAddress ?? ""} ${v.saleIp ?? ""}`.toLowerCase().includes(vSearch.toLowerCase())).length}/${data.vouchers.length}`
                          : data.vouchers.length}
                      </span>
                    )}
                  </div>
                  {data.vouchers.length > 0 && (
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
                      <input
                        type="text"
                        placeholder="Rechercher user, MAC ou IP…"
                        value={vSearch}
                        onChange={(e) => setVSearch(e.target.value)}
                        className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 placeholder-gray-400"
                      />
                      {vSearch && (
                        <button
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                          onClick={() => setVSearch("")}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </CardHeader>
                <CardContent className="p-0">
                  {data.vouchers.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-6 px-4">Aucune vente enregistrée</p>
                  ) : (() => {
                    const vFiltered = vSearch.trim()
                      ? data.vouchers.filter(v => `${v.username} ${v.macAddress ?? ""} ${v.saleIp ?? ""}`.toLowerCase().includes(vSearch.toLowerCase()))
                      : data.vouchers;
                    return vFiltered.length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-6 px-4">Aucun résultat pour « {vSearch} »</p>
                    ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[620px] text-xs border-collapse">
                        <thead>
                          <tr className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-900/80 backdrop-blur-sm border-b border-gray-200">
                            <th className="text-left px-3 py-2 font-semibold text-gray-500 uppercase tracking-wide text-[10px]">User</th>
                            <th className="text-right px-3 py-2 font-semibold text-gray-500 uppercase tracking-wide text-[10px]">Prix</th>
                            <th className="text-left px-3 py-2 font-semibold text-gray-500 uppercase tracking-wide text-[10px] hidden sm:table-cell">MAC</th>
                            <th className="text-left px-3 py-2 font-semibold text-gray-500 uppercase tracking-wide text-[10px] hidden md:table-cell">IP</th>
                            <th className="text-left px-3 py-2 font-semibold text-gray-500 uppercase tracking-wide text-[10px]">Date</th>
                            <th className="text-center px-3 py-2 font-semibold text-gray-500 uppercase tracking-wide text-[10px]">État</th>
                          </tr>
                        </thead>
                        <tbody>
                          {vFiltered.map((v, i) => {
                            const displayPrice = v.salePrice || v.price || "";
                            const dateObj = (() => {
                              const raw = v.usedAt || v.printedAt;
                              if (!raw) return null;
                              const dt = new Date(raw);
                              const dy = String(dt.getDate()).padStart(2, "0");
                              const hh = String(dt.getHours()).padStart(2, "0");
                              const mn = String(dt.getMinutes()).padStart(2, "0");
                              return { date: `${dy} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`, time: `${hh}:${mn}` };
                            })();
                            return (
                              <tr key={v.id} className={`transition-colors hover:bg-gray-50 ${i % 2 === 0 ? "" : "bg-gray-50/50"}`}>
                                <td className="px-3 py-2 max-w-[110px]">
                                  <p className="font-mono font-semibold text-gray-800 truncate">{v.username}</p>
                                  <p className="text-[10px] text-gray-400 truncate">{v.profileName}</p>
                                </td>
                                <td className="px-3 py-2 text-right whitespace-nowrap">
                                  {displayPrice ? (
                                    <span className="font-semibold text-emerald-600 tabular-nums">{Number(displayPrice).toLocaleString("fr-FR")}<span className="text-[9px] text-gray-400 ml-0.5">FCFA</span></span>
                                  ) : <span className="text-gray-300">—</span>}
                                </td>
                                <td className="px-3 py-2 hidden sm:table-cell">
                                  <span className="font-mono text-[10px] text-gray-500">{v.macAddress || <span className="text-gray-300">—</span>}</span>
                                </td>
                                <td className="px-3 py-2 hidden md:table-cell">
                                  <span className="font-mono text-[10px] text-gray-500">{v.saleIp || <span className="text-gray-300">—</span>}</span>
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap">
                                  {dateObj ? (
                                    <>
                                      <p className="text-gray-700">{dateObj.date}</p>
                                      <p className="text-[10px] text-gray-400 font-mono">{dateObj.time}</p>
                                    </>
                                  ) : <span className="text-gray-300">—</span>}
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-50 text-red-500 ring-1 ring-red-200 whitespace-nowrap">Vendu</span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    );
                  })()}
                </CardContent>
              </Card>
            </div>

            {/* ── Impression ── */}
            <div className="print-only">
              <p className="report-print-title">{hotspotName || "nanoTECH Vouchers Bills"} — Rapport de ventes</p>
              <p className="report-print-meta">
                Période : <strong>{data.label}</strong> &nbsp;·&nbsp; Imprimé le {new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
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
                      {[...data.byProfile].sort((a, b) => (parseFloat(String((a as any).price ?? "0").replace(/\s/g, "")) || 0) - (parseFloat(String((b as any).price ?? "0").replace(/\s/g, "")) || 0)).map((p) => (
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
                <thead>
                  <tr><th>#</th><th>Code</th><th>Forfait</th><th>Prix (FCFA)</th><th>Date / Heure</th></tr>
                </thead>
                <tbody>
                  {data.vouchers.map((v, i) => (
                    <tr key={v.id}>
                      <td>{i + 1}</td>
                      <td style={{ fontFamily: "monospace" }}>{v.username}</td>
                      <td>{v.profileName}</td>
                      <td>{(v.salePrice || v.price) ?? "—"}</td>
                      <td>{v.printedAt ? new Date(v.printedAt).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
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

function Dashboard({ token, vendor, onLogout }: {
  token: string;
  vendor: VendorInfo;
  onLogout: () => void;
}) {
  // ── Use module-level cache for instant display on mount ─────────────────
  // hadCacheRef stays stable so fetchData dependency array never changes.
  const hadCacheRef = useRef(_dc.token === token && _dc.data !== null);
  const [data, setData] = useState<PortalData | null>(hadCacheRef.current ? _dc.data : null);
  const [versData, setVersData] = useState<VersementData | null>(hadCacheRef.current ? _dc.versData : null);
  const [arrearsData, setArrearsData] = useState<DailyArrearsData | null>(hadCacheRef.current ? _dc.arrearsData : null);
  const [loading, setLoading] = useState(!hadCacheRef.current);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [showAvailable, setShowAvailable] = useState(false);
  const [recentSearch, setRecentSearch] = useState("");

  // Password change dialog
  const [showChangePwd, setShowChangePwd] = useState(false);
  const [pwdCurrent, setPwdCurrent] = useState("");
  const [pwdNew, setPwdNew] = useState("");
  const [pwdConfirm, setPwdConfirm] = useState("");
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdError, setPwdError] = useState("");
  const [pwdSuccess, setPwdSuccess] = useState(false);

  const handleChangePassword = async () => {
    setPwdError("");
    if (!pwdCurrent || !pwdNew || !pwdConfirm) { setPwdError("Tous les champs sont obligatoires"); return; }
    if (pwdNew.length < 4) { setPwdError("Le nouveau mot de passe doit comporter au moins 4 caractères"); return; }
    if (pwdNew !== pwdConfirm) { setPwdError("Les mots de passe ne correspondent pas"); return; }
    setPwdLoading(true);
    try {
      const res = await api("/vendor-portal/me/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPassword: pwdCurrent, newPassword: pwdNew }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        setPwdError(d.error ?? "Erreur lors du changement de mot de passe");
        return;
      }
      setPwdSuccess(true);
      setTimeout(() => { setShowChangePwd(false); setPwdSuccess(false); setPwdCurrent(""); setPwdNew(""); setPwdConfirm(""); }, 1800);
    } catch {
      setPwdError("Erreur réseau, veuillez réessayer");
    } finally {
      setPwdLoading(false);
    }
  };

  const now = new Date();
  const [reportDay,   setReportDay]   = useState(String(now.getDate()));
  const [reportMonth, setReportMonth] = useState(String(now.getMonth() + 1));
  const [reportYear,  setReportYear]  = useState(String(now.getFullYear()));
  const [reportView,  setReportView]  = useState<{ day: string; month: string; year: string } | null>(null);
  const [periodView,  setPeriodView]  = useState<"today" | "yesterday" | "week" | "month" | null>(null);

  const notifiedProfilesRef = useRef<Set<string>>(new Set());
  const periodCacheRef = useRef<Map<string, PeriodSalesData>>(new Map());

  const fetchData = useCallback(async (showLoading = true) => {
    // Spinner skeleton uniquement si on n'a aucune donnée à afficher
    if (showLoading && !hadCacheRef.current) setLoading(true);
    setError("");
    setIsRefreshing(true);
    const headers = { Authorization: `Bearer ${token}` };
    let logoutTriggered = false;

    // Les 3 endpoints partent en parallèle. Chacun met à jour son propre
    // morceau d'état dès qu'il revient — le tableau de bord se peint au
    // fur et à mesure au lieu d'attendre le plus lent.
    const dashPromise = api("/vendor-portal/me", { headers })
      .then(async (res) => {
        if (res.status === 401 || res.status === 403) {
          if (!logoutTriggered) { logoutTriggered = true; onLogout(); }
          return;
        }
        if (!res.ok) throw new Error("dashboard");
        const d = await res.json() as PortalData;
        setData(d);
        _dc.token = token;
        _dc.data  = d;
        // Dès que le coeur du dashboard arrive, on cache la skeleton
        setLoading(false);
      })
      .catch(() => {
        if (!hadCacheRef.current) setError("Erreur lors du chargement des données");
      });

    const paymentsPromise = api("/vendor-portal/me/payments", { headers })
      .then(async (res) => {
        if (!res.ok) return;
        const v = await res.json() as VersementData;
        setVersData(v);
        _dc.versData = v;
      })
      .catch(() => { /* non-bloquant */ });

    const arrearsPromise = api("/vendor-portal/me/daily-arrears", { headers })
      .then(async (res) => {
        if (!res.ok) return;
        const a = await res.json() as DailyArrearsData;
        setArrearsData(a);
        _dc.arrearsData = a;
      })
      .catch(() => { /* non-bloquant */ });

    try {
      await Promise.allSettled([dashPromise, paymentsPromise, arrearsPromise]);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [token, onLogout]);

  const prefetchPeriods = useCallback(() => {
    const periods = ["today", "yesterday", "week", "month"] as const;
    periods.forEach(async (p) => {
      try {
        const res = await api(`/vendor-portal/me/period-sales?period=${p}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) periodCacheRef.current.set(p, await res.json());
      } catch { /* ignore — best effort */ }
    });
  }, [token]);

  useEffect(() => {
    fetchData(true).then(() => { prefetchPeriods(); });
    // Refresh discret toutes les 8 s pour un ressenti temps réel.
    // Côté serveur, le cache TTL=20 s + stale-while-revalidate font que la
    // plupart des requêtes sont servies instantanément (pure mémoire).
    const id = setInterval(() => { fetchData(false); }, 8_000);
    // Le prefetch des rapports périodes reste à 30 s (plus lourd, change peu).
    const idPeriod = setInterval(() => { prefetchPeriods(); }, 30_000);
    return () => { clearInterval(id); clearInterval(idPeriod); };
  }, [fetchData, prefetchPeriods]);

  // Demander la permission de notification au montage
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  // Notifier quand un forfait tombe sous 100 disponibles
  useEffect(() => {
    if (!data?.byProfile) return;
    data.byProfile.forEach((p) => {
      const available = p.total - p.used;
      if (available < 100 && !notifiedProfilesRef.current.has(p.profileName)) {
        notifiedProfilesRef.current.add(p.profileName);
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification("⚠️ Stock faible — nanoTECH Vouchers Bills", {
            body: `Forfait « ${p.profileName} » : seulement ${available} ticket(s) disponible(s).`,
            icon: "/favicon.ico",
          });
        }
      }
    });
  }, [data]);

  if (periodView) {
    return <PeriodReport token={token} period={periodView} onBack={() => setPeriodView(null)} hotspotName={data?.hotspotName} initialData={periodCacheRef.current.get(periodView)} />;
  }

  if (reportView) {
    return (
      <DayReport
        token={token}
        day={reportView.day}
        month={reportView.month}
        year={reportView.year}
        onBack={() => setReportView(null)}
        hotspotName={data?.hotspotName}
      />
    );
  }

  const chartData = data
    ? [
        { label: "Hier",          montant: data.salesStats.yesterdayAmount },
        { label: "Aujourd'hui",   montant: data.salesStats.todayAmount },
        { label: "Sem. dern.",    montant: data.salesStats.weekAmount },
        { label: "Mois en cours", montant: data.salesStats.lastMonthAmount },
      ]
    : [];

  const years = [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2];
  const days  = Array.from({ length: 31 }, (_, i) => i + 1);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-blue-600 flex items-center justify-center">
            <Wifi className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">nanoTECH Vouchers Bills</p>
            <p className="text-xs text-gray-500">Espace vendeur</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-2 text-sm text-gray-700 bg-gray-100 rounded-lg px-3 py-1.5">
            <User className="h-4 w-4" />
            {vendor.name}
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => fetchData(true)}
            disabled={isRefreshing}
            title={isRefreshing ? "Synchronisation en cours…" : "Actualiser"}
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin text-blue-600" : ""}`} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5"
            title="Modifier mot de passe"
            onClick={() => { setPwdCurrent(""); setPwdNew(""); setPwdConfirm(""); setPwdError(""); setPwdSuccess(false); setShowChangePwd(true); }}
          >
            <KeyRound className="h-4 w-4" />
            <span className="hidden sm:inline">Modifier mot de passe</span>
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300" title="Se déconnecter" onClick={onLogout}>
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Se déconnecter</span>
          </Button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Mes performances</h2>
          <p className="text-sm text-gray-500">Bienvenue, {vendor.name}</p>
        </div>

        {loading && !data && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 animate-pulse" aria-label="Chargement du tableau de bord">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-3 flex items-center gap-2.5">
                  <div className="h-9 w-9 rounded-xl bg-gray-200 flex-shrink-0" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="h-5 bg-gray-200 rounded w-2/3" />
                    <div className="h-2.5 bg-gray-100 rounded w-1/2" />
                    <div className="h-2.5 bg-gray-100 rounded w-3/4" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        {error && !data && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">{error}</div>}

        {data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <StatCard label="Tickets disponibles" value={data.totalAvailable} icon={Ticket}       color="bg-blue-500"   onClick={() => setShowAvailable(true)} />
              <StatCard label="Vendus aujourd'hui"  value={data.salesStats.todayAmount}     icon={ShoppingCart} color="bg-green-500"  onClick={() => setPeriodView("today")}     fcfa sub={data.salesStats.todaySold} />
              <StatCard label="Vendus hier"         value={data.salesStats.yesterdayAmount} icon={Clock}        color="bg-yellow-500" onClick={() => setPeriodView("yesterday")} fcfa sub={data.salesStats.yesterdaySold} />
              <StatCard label="Semaine dernière"    value={data.salesStats.weekAmount}      icon={Calendar}     color="bg-orange-500" onClick={() => setPeriodView("week")}      fcfa sub={data.salesStats.weekSold} />
              <StatCard label="Mois en cours"       value={data.salesStats.lastMonthAmount} icon={TrendingUp}   color="bg-purple-500" onClick={() => setPeriodView("month")}     fcfa sub={data.salesStats.lastMonthSold} />

              <Card className="col-span-2 md:col-span-1">
                <CardContent className="p-3 flex flex-col gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <div className="h-6 w-6 rounded-md bg-indigo-500 flex items-center justify-center flex-shrink-0">
                      <Search className="h-3 w-3 text-white" />
                    </div>
                    <p className="text-xs font-medium text-gray-700 leading-tight">Ventes d&apos;une période</p>
                  </div>
                  <div className="flex gap-1">
                    <Select value={reportDay} onValueChange={setReportDay}>
                      <SelectTrigger className="text-[11px] h-7 px-1.5 flex-1 min-w-0"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {days.map((d) => (
                          <SelectItem key={d} value={String(d)} className="text-xs">{String(d).padStart(2,"0")}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={reportMonth} onValueChange={setReportMonth}>
                      <SelectTrigger className="text-[11px] h-7 px-1.5 flex-1 min-w-0"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MONTHS.map((m, i) => (
                          <SelectItem key={i + 1} value={String(i + 1)} className="text-xs">{m.slice(0, 3)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={reportYear} onValueChange={setReportYear}>
                      <SelectTrigger className="text-[11px] h-7 px-1.5 flex-1 min-w-0"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {years.map((y) => (
                          <SelectItem key={y} value={String(y)} className="text-xs">{y}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      className="h-7 px-2 bg-indigo-600 hover:bg-indigo-700 text-[11px] flex-shrink-0"
                      onClick={() => setReportView({ day: reportDay, month: reportMonth, year: reportYear })}
                    >
                      Voir
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* ── Arriérés journaliers ──────────────────────────────── */}
            {arrearsData && arrearsData.days.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-orange-500" />
                  <h3 className="text-sm font-semibold text-gray-700">Mes versements non effectués</h3>
                </div>
                <Card className="border border-orange-200 bg-orange-50/20">
                  <CardContent className="p-0">
                    <div className="divide-y divide-orange-100">
                      {consolidateDailyArrears(arrearsData.days.slice().sort((a, b) => a.date.localeCompare(b.date))).map((d) => {
                        const dateObj = new Date(d.date + "T00:00:00Z");
                        const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
                        const weekday  = cap(dateObj.toLocaleDateString("fr-FR", { weekday: "long", timeZone: "UTC" }));
                        const dayNum   = String(dateObj.getUTCDate());
                        const monthNum = String(dateObj.getUTCMonth() + 1);
                        const yearNum  = String(dateObj.getUTCFullYear());
                        const monthLabel = cap(dateObj.toLocaleDateString("fr-FR", { month: "long", timeZone: "UTC" }));
                        const label    = d.__underlyingCount
                          ? `Arriérés cumulés (${d.__underlyingCount} jours, dernier : ${weekday} ${dayNum.padStart(2,"0")} ${monthLabel} ${yearNum})`
                          : `Arriéré du ${weekday} ${dayNum.padStart(2,"0")} ${monthLabel} ${yearNum}`;
                        return (
                          <button
                            key={d.date}
                            type="button"
                            onClick={() => setReportView({ day: dayNum, month: monthNum, year: yearNum })}
                            className="w-full text-left flex items-center justify-between gap-2 px-4 py-2.5 overflow-hidden hover:bg-orange-50 active:bg-orange-100 transition-colors cursor-pointer"
                          >
                            <span className="text-[11px] font-semibold text-orange-700 whitespace-nowrap truncate flex-1 min-w-0 flex items-center gap-1.5">
                              {label}
                              <ChevronRight className="h-3 w-3 opacity-50 flex-shrink-0" />
                            </span>
                            <div className="flex items-center gap-2 flex-shrink-0 whitespace-nowrap pl-2">
                              <span className="text-[10px] text-gray-400 tabular-nums">{d.count} ticket{d.count !== 1 ? "s" : ""}</span>
                              <span className="text-[11px] font-bold text-orange-700 tabular-nums">{fmtFcfa(d.remaining)} FCFA</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    <div className="border-t border-orange-200 bg-orange-50 flex items-center justify-between px-4 py-2 rounded-b-lg">
                      <span className="text-xs font-semibold text-orange-700">Total arriérés</span>
                      <span className="text-sm font-bold text-orange-700 tabular-nums">
                        {fmtFcfa(arrearsData.days.reduce((s, d) => s + d.remaining, 0))} FCFA
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* ── Versements ───────────────────────────────────────── */}
            {versData && versData.weeks.some((w) => w.count > 0 || w.payments.length > 0) && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-blue-500" />
                  <h3 className="text-sm font-semibold text-gray-700">Mes versements</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {versData.weeks.map((w, i) => {
                    if (w.count === 0 && w.payments.length === 0) return null;
                    const isSolde   = w.remaining === 0 && (w.totalPaid > 0 || w.commission >= w.amount);
                    const dueAmount = Math.max(0, w.amount - w.commission); // what vendor must pay back
                    const paidPct   = dueAmount > 0 ? Math.min(100, Math.round((w.totalPaid / dueAmount) * 100)) : 100;
                    return (
                      <Card key={w.weekStart} className={`border ${isSolde ? "border-emerald-200 bg-emerald-50/30" : i === 0 ? "border-orange-200 bg-orange-50/20" : "border-gray-100"}`}>
                        <CardContent className="p-4 space-y-3">
                          {/* Header */}
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                                {i === 0 ? "Semaine en cours" : "Semaine dernière"}
                              </p>
                              <p className="text-[11px] text-gray-400">{w.label}</p>
                            </div>
                            {isSolde ? (
                              <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-100 border border-emerald-200 rounded-full px-2 py-0.5 flex-shrink-0">
                                <CheckCircle2 className="h-3 w-3" /> Soldé
                              </span>
                            ) : w.count > 0 ? (
                              <span className="text-[10px] font-semibold text-orange-600 bg-orange-100 border border-orange-200 rounded-full px-2 py-0.5 flex-shrink-0">
                                En attente
                              </span>
                            ) : null}
                          </div>

                          {/* Stats */}
                          <div className="grid grid-cols-3 gap-1 text-center">
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-gray-800 tabular-nums truncate">{fmtFcfa(w.amount)}</p>
                              <p className="text-[9px] text-gray-400">Ventes</p>
                              <p className="text-[9px] text-gray-400">{w.count} ticket{w.count !== 1 ? "s" : ""}</p>
                            </div>
                            <div className="min-w-0">
                              <p className={`text-xs font-bold tabular-nums truncate ${w.totalPaid > 0 ? "text-emerald-600" : "text-gray-300"}`}>{fmtFcfa(w.totalPaid)}</p>
                              <p className="text-[9px] text-gray-400">Versé</p>
                            </div>
                            <div className="min-w-0">
                              <p className={`text-xs font-bold tabular-nums truncate ${w.remaining > 0 ? "text-orange-600" : "text-gray-300"}`}>{fmtFcfa(w.remaining)}</p>
                              <p className="text-[9px] text-gray-400">Reste</p>
                            </div>
                          </div>

                          {/* Versements détaillés (journalier vs hebdomadaire) */}
                          {((w.dailyPaid ?? 0) > 0 || (w.weeklyPaid ?? 0) > 0) && (
                            <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                              {(w.dailyPaid ?? 0) > 0 && (
                                <div className="rounded bg-sky-50 border border-sky-100 px-2 py-1 flex items-center justify-between">
                                  <span className="text-sky-600">Journalier</span>
                                  <span className="font-bold text-sky-700 tabular-nums">{fmtFcfa(w.dailyPaid!)}</span>
                                </div>
                              )}
                              {(w.weeklyPaid ?? 0) > 0 && (
                                <div className="rounded bg-emerald-50 border border-emerald-100 px-2 py-1 flex items-center justify-between">
                                  <span className="text-emerald-600">Hebdo.</span>
                                  <span className="font-bold text-emerald-700 tabular-nums">{fmtFcfa(w.weeklyPaid!)}</span>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Hebdomadaire à régler après déduction des journaliers */}
                          {(w.dailyPaid ?? 0) > 0 && (w.weeklyExpected ?? 0) > 0 && (
                            <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 flex items-center justify-between">
                              <span className="text-[11px] font-semibold text-blue-700">Hebdo. à régler</span>
                              <span className="text-sm font-bold text-blue-700 tabular-nums">{fmtFcfa(w.weeklyExpected!)} FCFA</span>
                            </div>
                          )}

                          {/* Commission row — only if rate is configured */}
                          {w.commissionRate > 0 && (
                            <div className="flex items-center justify-between gap-2 rounded-lg bg-violet-50 border border-violet-100 px-3 py-2">
                              <div className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-violet-700 min-w-0">
                                <span className="font-semibold whitespace-nowrap">Votre rémunération</span>
                                <span className="text-violet-400 whitespace-nowrap">({w.commissionRate}%)</span>
                              </div>
                              <p className="text-sm font-bold text-violet-700 tabular-nums whitespace-nowrap flex-shrink-0">{fmtFcfa(w.commission)} FCFA</p>
                            </div>
                          )}

                          {/* Progress bar */}
                          {w.amount > 0 && (
                            <div>
                              <div className="relative h-2 rounded-full overflow-hidden bg-gray-100">
                                <div
                                  className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${isSolde ? "bg-emerald-500" : "bg-blue-500"}`}
                                  style={{ width: `${paidPct}%` }}
                                />
                              </div>
                              <p className="text-[10px] text-gray-400 mt-0.5 text-right">{paidPct}% versé</p>
                            </div>
                          )}

                          {/* Payments list */}
                          {w.payments.length > 0 && (
                            <div className="space-y-1 pt-1 border-t border-gray-100">
                              {w.payments.map((p) => (
                                <div key={p.id} className="flex items-center gap-2 text-[11px]">
                                  <CheckCircle2 className="h-3 w-3 text-emerald-500 flex-shrink-0" />
                                  <span className="font-semibold text-gray-700 tabular-nums">{fmtFcfa(p.amount)} FCFA</span>
                                  <span className="text-gray-400">
                                    {new Date(p.paidAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}
                                  </span>
                                  {p.note && <span className="text-gray-400 italic truncate">— {p.note}</span>}
                                </div>
                              ))}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Stock par forfait ─────────────────────────────────── */}
            {data.byProfile.length > 0 && (
              <Card>
                <CardHeader className="pb-2 border-b border-gray-100">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <PackageOpen className="h-4 w-4 text-gray-400" />
                      Stock tickets — ce mois
                    </CardTitle>
                    <span className="text-xs text-gray-400">↻ 30s</span>
                  </div>
                </CardHeader>
                <CardContent className="pt-4">
                  <div className="space-y-3">
                    {data.byProfile.map((p) => {
                      const available      = p.total - p.used;
                      const soldThisMonth  = p.soldThisMonth ?? 0;
                      const total          = available + soldThisMonth;
                      const usedPct        = total > 0 ? Math.round((soldThisMonth / total) * 100) : 0;
                      const isLow          = available < 100;

                      const barColor   = isLow ? "bg-orange-400" : "bg-emerald-500";
                      const trackColor = isLow ? "bg-orange-100" : "bg-emerald-100";
                      const textColor  = isLow ? "text-orange-600" : "text-emerald-600";

                      return (
                        <div key={p.profileName}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-sm font-medium text-gray-700 truncate">{p.profileName}</span>
                              {isLow && (
                                <span className="flex items-center gap-0.5 text-xs font-semibold text-orange-500">
                                  <Bell className="h-3 w-3" /> Stock faible
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-xs flex-shrink-0">
                              <span className="text-gray-400">
                                {soldThisMonth} vendu{soldThisMonth !== 1 ? "s" : ""} ce mois
                              </span>
                              <span className={`font-semibold ${textColor}`}>
                                {available} disponible{available !== 1 ? "s" : ""}
                              </span>
                            </div>
                          </div>

                          {/* Jauge */}
                          <div className={`relative h-2.5 rounded-full overflow-hidden ${trackColor}`}>
                            <div
                              className="absolute inset-y-0 left-0 bg-gray-300 rounded-l-full transition-all duration-500"
                              style={{ width: `${usedPct}%` }}
                            />
                            <div
                              className={`absolute inset-y-0 rounded-full transition-all duration-500 ${barColor}`}
                              style={{ left: `${usedPct}%`, right: 0 }}
                            />
                          </div>

                          <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
                            <span>Vendus ce mois ({usedPct}%)</span>
                            <span>Disponibles ({100 - usedPct}%)</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Évolution des ventes</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={30} />
                    <Tooltip />
                    <Bar dataKey="montant" name="Montant (FCFA)" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {data.byProfile.length > 0 && (
              <Card>
                <CardHeader className="pb-2 border-b border-gray-100">
                  <CardTitle className="text-base">Vendus par forfait (ce mois)</CardTitle>
                </CardHeader>
                <CardContent className="pt-3">
                  <div className="space-y-2">
                    {[...data.byProfile]
                      .sort((a, b) => (parseFloat(String((a as any).price ?? "0").replace(/\s/g, "")) || 0) - (parseFloat(String((b as any).price ?? "0").replace(/\s/g, "")) || 0))
                      .map((p) => {
                        const available = p.total - p.used;
                        const soldThisMonth = p.soldThisMonth ?? 0;
                        return (
                          <div key={p.profileName} className="flex items-center justify-between py-2 border-b last:border-0">
                            <span className="text-sm font-medium text-gray-700">{p.profileName}</span>
                            <div className="flex gap-3 text-sm">
                              <span className="text-red-600">Vendu: <strong>{soldThisMonth}</strong></span>
                              <span className="text-green-600">Restants: <strong>{available}</strong></span>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="flex flex-col overflow-hidden">
              <CardHeader className="pb-2 flex-shrink-0">
                <div className="flex items-center justify-between mb-2">
                  <CardTitle className="text-base">Ventes récentes <span className="text-[10px] font-normal text-gray-400">(90 jours)</span></CardTitle>
                  {data.recentSales.length > 0 && (
                    <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full tabular-nums">
                      {recentSearch.trim()
                        ? `${data.recentSales.filter(v => `${v.username} ${v.macAddress ?? ""} ${v.saleIp ?? ""}`.toLowerCase().includes(recentSearch.toLowerCase())).length}/${data.recentSales.length}`
                        : data.recentSales.length}
                    </span>
                  )}
                </div>
                {data.recentSales.length > 0 && (
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Rechercher user, MAC ou IP…"
                      value={recentSearch}
                      onChange={(e) => setRecentSearch(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 placeholder-gray-400"
                    />
                    {recentSearch && (
                      <button
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        onClick={() => setRecentSearch("")}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </CardHeader>
              <CardContent className="p-0">
                {data.recentSales.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8 px-4">Aucune vente enregistrée</p>
                ) : (() => {
                  const filtered = recentSearch.trim()
                    ? data.recentSales.filter(v =>
                        `${v.username} ${v.macAddress ?? ""} ${v.saleIp ?? ""}`.toLowerCase().includes(recentSearch.toLowerCase())
                      )
                    : data.recentSales;
                  return filtered.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-8 px-4">Aucun résultat pour « {recentSearch} »</p>
                  ) : (
                  <div className="max-h-[360px] overflow-x-auto overflow-y-auto scroll-card">
                    <table className="w-full min-w-[620px] text-xs border-collapse">
                      <thead>
                        <tr className="sticky top-0 z-10 bg-gray-50 dark:bg-gray-900/80 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700">
                          <th className="text-left px-3 py-2 font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide text-[10px]">User</th>
                          <th className="text-right px-3 py-2 font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide text-[10px]">Prix</th>
                          <th className="text-left px-3 py-2 font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide text-[10px] hidden sm:table-cell">MAC</th>
                          <th className="text-left px-3 py-2 font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide text-[10px] hidden md:table-cell">IP</th>
                          <th className="text-left px-3 py-2 font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide text-[10px]">Date</th>
                          <th className="text-center px-3 py-2 font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide text-[10px]">État</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((v, i) => {
                          const displayPrice = v.salePrice || v.price || "";
                          const dateStr = v.printedAt ? (() => {
                            const d = new Date(v.printedAt);
                            const day = String(d.getDate()).padStart(2, "0");
                            const month = MONTHS[d.getMonth()];
                            const hh = String(d.getHours()).padStart(2, "0");
                            const mm = String(d.getMinutes()).padStart(2, "0");
                            const ss = String(d.getSeconds()).padStart(2, "0");
                            return `${day} ${month} ${d.getFullYear()} ${hh}:${mm}:${ss}`;
                          })() : "—";
                          return (
                            <tr
                              key={v.id}
                              className={`transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50 ${i % 2 === 0 ? "" : "bg-gray-50/50 dark:bg-gray-800/20"}`}
                            >
                              {/* User */}
                              <td className="px-3 py-2 max-w-[110px]">
                                <p className="font-mono font-semibold text-gray-800 dark:text-gray-100 truncate">{v.username}</p>
                                <p className="text-[10px] text-gray-400 truncate">{v.profileName}</p>
                              </td>
                              {/* Prix */}
                              <td className="px-3 py-2 text-right whitespace-nowrap">
                                {displayPrice ? (
                                  <span className="font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                                    {Number(displayPrice).toLocaleString("fr-FR")}
                                    <span className="text-[9px] text-gray-400 ml-0.5">FCFA</span>
                                  </span>
                                ) : (
                                  <span className="text-gray-300 dark:text-gray-600">—</span>
                                )}
                              </td>
                              {/* MAC */}
                              <td className="px-3 py-2 hidden sm:table-cell">
                                <span className="font-mono text-[10px] text-gray-500 dark:text-gray-400">
                                  {v.macAddress || <span className="text-gray-300 dark:text-gray-600">—</span>}
                                </span>
                              </td>
                              {/* IP */}
                              <td className="px-3 py-2 hidden md:table-cell">
                                <span className="font-mono text-[10px] text-gray-500 dark:text-gray-400">
                                  {v.saleIp || <span className="text-gray-300 dark:text-gray-600">—</span>}
                                </span>
                              </td>
                              {/* Date */}
                              <td className="px-3 py-2 whitespace-nowrap">
                                <span className="text-gray-600 dark:text-gray-300">{dateStr}</span>
                              </td>
                              {/* État */}
                              <td className="px-3 py-2 text-center">
                                <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-50 dark:bg-red-950/50 text-red-500 dark:text-red-400 ring-1 ring-red-200 dark:ring-red-800/50 whitespace-nowrap">
                                  Vendu
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  );
                })()}
              </CardContent>
            </Card>

            <AvailableVouchersModal open={showAvailable} onClose={() => setShowAvailable(false)} vouchers={data.availableVouchers} />
          </>
        )}
      </main>

      {/* Change password dialog */}
      <Dialog open={showChangePwd} onOpenChange={(o) => { if (!o) setShowChangePwd(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-blue-600" />
              Modifier mon mot de passe
            </DialogTitle>
          </DialogHeader>
          {pwdSuccess ? (
            <div className="flex flex-col items-center gap-3 py-6 text-emerald-600">
              <CheckCircle2 className="h-10 w-10" />
              <p className="font-semibold">Mot de passe modifié avec succès</p>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              {pwdError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{pwdError}</p>
              )}
              <div>
                <Label htmlFor="pwd-current">Ancien mot de passe</Label>
                <Input
                  id="pwd-current"
                  type="password"
                  className="mt-1"
                  placeholder="••••••••"
                  value={pwdCurrent}
                  onChange={(e) => setPwdCurrent(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              <div>
                <Label htmlFor="pwd-new">Nouveau mot de passe</Label>
                <Input
                  id="pwd-new"
                  type="password"
                  className="mt-1"
                  placeholder="••••••••"
                  value={pwdNew}
                  onChange={(e) => setPwdNew(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <div>
                <Label htmlFor="pwd-confirm">Confirmer le nouveau mot de passe</Label>
                <Input
                  id="pwd-confirm"
                  type="password"
                  className="mt-1"
                  placeholder="••••••••"
                  value={pwdConfirm}
                  onChange={(e) => setPwdConfirm(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
            </div>
          )}
          {!pwdSuccess && (
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowChangePwd(false)} disabled={pwdLoading}>
                Annuler
              </Button>
              <Button onClick={handleChangePassword} disabled={pwdLoading} className="gap-2">
                {pwdLoading ? "Enregistrement..." : "Modifier le mot de passe"}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function VendorPortal() {
  const { token, vendorInfo, logout } = useAuth();
  const appNavigate = useAppNavigate();

  if (!token || !vendorInfo) return null;

  const vendor: VendorInfo = {
    id: vendorInfo.id,
    name: vendorInfo.name,
    email: vendorInfo.email,
    username: vendorInfo.username,
  };

  const handleLogout = () => {
    logout();
    appNavigate("/vendeur");
  };

  return <Dashboard token={token} vendor={vendor} onLogout={handleLogout} />;
}
