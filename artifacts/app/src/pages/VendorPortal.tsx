import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
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
  User, RefreshCw, Clock, ChevronLeft, Search, Banknote, Printer, LogIn,
  PackageOpen, Bell, Wallet, CheckCircle2,
} from "lucide-react";

const TOKEN_KEY = "vouchernet_vendor_token";
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type VendorInfo = { id: number; name: string; email: string | null; username: string | null };
type SalesStats = {
  todaySold: number; todayAmount: number;
  yesterdaySold: number; yesterdayAmount: number;
  weekSold: number; weekAmount: number;
  lastMonthSold: number; lastMonthAmount: number;
};
type ByProfile = { profileName: string; total: number; printed: number; used: number; soldToday: number };
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
  totalPaid: number;
  remaining: number;
  payments: { id: number; amount: number; paidAt: string; note: string | null }[];
};
type VersementData = { weeks: VersementWeek[] };
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
  const len = formatted.replace(/\s/g, "").length;
  if (len <= 5)  return "text-2xl";
  if (len <= 7)  return "text-xl";
  if (len <= 9)  return "text-lg";
  return "text-base";
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
    <CardContent className="p-4 flex items-center gap-4">
      <div className={`h-12 w-12 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
        <Icon className="h-6 w-6 text-white" />
      </div>
      <div>
        <div className="flex items-baseline gap-1">
          <p className={`${fcfa ? amountFontClass(formatted) : "text-2xl"} font-bold text-gray-900 tabular-nums`}>{formatted}</p>
          {fcfa && <span className="text-xs font-medium text-gray-400">FCFA</span>}
        </div>
        {sub !== undefined && (
          <p className="text-xs text-gray-400">{sub} ticket{sub !== 1 ? "s" : ""}</p>
        )}
        <p className="text-xs text-gray-500 mt-0.5">{label}</p>
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
          <h1 className="text-2xl font-bold text-white">VoucherNet</h1>
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

  useEffect(() => {
    setLoading(true);
    setError("");
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
          <Button size="sm" variant="outline" onClick={() => window.print()} className="gap-1.5">
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
            acc[v.profileName].revenue += parseFloat(v.price ?? "0") || 0;
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
                        <p className="text-2xl font-bold text-gray-900">{data.revenue.toLocaleString("fr-FR")}</p>
                        <p className="text-xs text-gray-500">FCFA estimé</p>
                      </div>
                    </CardContent>
                  </Card>
                </div>
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">Tickets vendus ({data.total})</CardTitle>
                      {data.vouchers.length > 0 && (
                        <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full tabular-nums">{data.vouchers.length}</span>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    {data.vouchers.length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-6 px-4">Aucune vente ce jour</p>
                    ) : (
                      <div className="max-h-80 overflow-y-auto scroll-card">
                        <table className="w-full text-xs border-collapse">
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
                            {data.vouchers.map((v, i) => {
                              const displayPrice = v.salePrice || v.price || "";
                              const dateObj = (() => {
                                const raw = v.usedAt || v.printedAt;
                                if (!raw) return null;
                                const d = new Date(raw);
                                const day = String(d.getDate()).padStart(2, "0");
                                const hh = String(d.getHours()).padStart(2, "0");
                                const mn = String(d.getMinutes()).padStart(2, "0");
                                return { date: `${day} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`, time: `${hh}:${mn}` };
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
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* ── Impression ── */}
              <div className="print-only">
                <p className="report-print-title">{hotspotName || "VoucherNet"} — Rapport de ventes</p>
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
                        <td>{v.price ?? "—"}</td>
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

function PeriodReport({ token, period, onBack, hotspotName }: {
  token: string;
  period: "today" | "yesterday" | "week" | "month";
  onBack: () => void;
  hotspotName?: string | null;
}) {
  const [data, setData] = useState<PeriodSalesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    api(`/vendor-portal/me/period-sales?period=${period}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? "Erreur");
        return res.json();
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token, period]);

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
          <Button size="sm" variant="outline" onClick={() => window.print()} className="gap-1.5">
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
                      <p className="text-2xl font-bold text-gray-900">{data.revenue.toLocaleString("fr-FR")}</p>
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
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Tickets vendus ({data.total})</CardTitle>
                    {data.vouchers.length > 0 && (
                      <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full tabular-nums">{data.vouchers.length}</span>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {data.vouchers.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-6 px-4">Aucune vente enregistrée</p>
                  ) : (
                    <div className="max-h-80 overflow-y-auto scroll-card">
                      <table className="w-full text-xs border-collapse">
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
                          {data.vouchers.map((v, i) => {
                            const displayPrice = v.salePrice || v.price || "";
                            const dateObj = (() => {
                              const raw = v.usedAt || v.printedAt;
                              if (!raw) return null;
                              const d = new Date(raw);
                              const day = String(d.getDate()).padStart(2, "0");
                              const hh = String(d.getHours()).padStart(2, "0");
                              const mn = String(d.getMinutes()).padStart(2, "0");
                              return { date: `${day} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`, time: `${hh}:${mn}` };
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
                  )}
                </CardContent>
              </Card>
            </div>

            {/* ── Impression ── */}
            <div className="print-only">
              <p className="report-print-title">{hotspotName || "VoucherNet"} — Rapport de ventes</p>
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
                      <td>{v.price ?? "—"}</td>
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
  const [data, setData] = useState<PortalData | null>(null);
  const [versData, setVersData] = useState<VersementData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAvailable, setShowAvailable] = useState(false);

  const now = new Date();
  const [reportDay,   setReportDay]   = useState(String(now.getDate()));
  const [reportMonth, setReportMonth] = useState(String(now.getMonth() + 1));
  const [reportYear,  setReportYear]  = useState(String(now.getFullYear()));
  const [reportView,  setReportView]  = useState<{ day: string; month: string; year: string } | null>(null);
  const [periodView,  setPeriodView]  = useState<"today" | "yesterday" | "week" | "month" | null>(null);

  const notifiedProfilesRef = useRef<Set<string>>(new Set());

  const fetchData = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError("");
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [res, versRes] = await Promise.all([
        api("/vendor-portal/me", { headers }),
        api("/vendor-portal/me/payments", { headers }),
      ]);
      if (res.status === 401 || res.status === 403) { onLogout(); return; }
      setData(await res.json());
      if (versRes.ok) setVersData(await versRes.json());
    } catch {
      setError("Erreur lors du chargement des données");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [token, onLogout]);

  useEffect(() => {
    fetchData(true);
    // Silent background refresh every 15s — no loading spinner shown
    const id = setInterval(() => fetchData(false), 15_000);
    return () => clearInterval(id);
  }, [fetchData]);

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
          new Notification("⚠️ Stock faible — VoucherNet", {
            body: `Forfait « ${p.profileName} » : seulement ${available} ticket(s) disponible(s).`,
            icon: "/favicon.ico",
          });
        }
      }
    });
  }, [data]);

  if (periodView) {
    return <PeriodReport token={token} period={periodView} onBack={() => setPeriodView(null)} hotspotName={data?.hotspotName} />;
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
            <p className="text-sm font-semibold text-gray-900">VoucherNet</p>
            <p className="text-xs text-gray-500">Espace vendeur</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-2 text-sm text-gray-700 bg-gray-100 rounded-lg px-3 py-1.5">
            <User className="h-4 w-4" />
            {vendor.name}
          </div>
          <Button size="sm" variant="ghost" onClick={() => fetchData(true)} title="Actualiser">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300" onClick={onLogout}>
            <LogOut className="h-4 w-4" /> Se déconnecter
          </Button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Mes performances</h2>
          <p className="text-sm text-gray-500">Bienvenue, {vendor.name}</p>
        </div>

        {loading && !data && <div className="text-center py-12 text-gray-400">Chargement...</div>}
        {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">{error}</div>}

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
                    const isSolde   = w.remaining === 0 && w.totalPaid > 0;
                    const paidPct   = w.amount > 0 ? Math.min(100, Math.round((w.totalPaid / w.amount) * 100)) : 0;
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
                          <div className="grid grid-cols-3 gap-2 text-center">
                            <div>
                              <p className="text-base font-bold text-gray-800 tabular-nums">{fmtFcfa(w.amount)}</p>
                              <p className="text-[10px] text-gray-400">Ventes (FCFA)</p>
                              <p className="text-[10px] text-gray-400">{w.count} ticket{w.count !== 1 ? "s" : ""}</p>
                            </div>
                            <div>
                              <p className={`text-base font-bold tabular-nums ${w.totalPaid > 0 ? "text-emerald-600" : "text-gray-300"}`}>{fmtFcfa(w.totalPaid)}</p>
                              <p className="text-[10px] text-gray-400">Versé (FCFA)</p>
                            </div>
                            <div>
                              <p className={`text-base font-bold tabular-nums ${w.remaining > 0 ? "text-orange-600" : "text-gray-300"}`}>{fmtFcfa(w.remaining)}</p>
                              <p className="text-[10px] text-gray-400">Reste (FCFA)</p>
                            </div>
                          </div>

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
                      Stock tickets — aujourd&apos;hui
                    </CardTitle>
                    <span className="text-xs text-gray-400">↻ 30s</span>
                  </div>
                </CardHeader>
                <CardContent className="pt-4">
                  <div className="space-y-3">
                    {data.byProfile.map((p) => {
                      const available = p.total - p.used;
                      const soldToday = p.soldToday ?? 0;
                      const total     = available + soldToday;
                      const usedPct   = total > 0 ? Math.round((soldToday / total) * 100) : 0;
                      const isLow     = available < 100;

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
                                {soldToday} vendu{soldToday !== 1 ? "s" : ""} auj.
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
                            <span>Vendus ({usedPct}%)</span>
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
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Par forfait</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {[...data.byProfile].sort((a, b) => (parseFloat(String((a as any).price ?? "0").replace(/\s/g, "")) || 0) - (parseFloat(String((b as any).price ?? "0").replace(/\s/g, "")) || 0)).map((p) => (
                      <div key={p.profileName} className="flex items-center justify-between py-2 border-b last:border-0">
                        <span className="text-sm font-medium text-gray-700">{p.profileName}</span>
                        <div className="flex gap-3 text-sm">
                          <span className="text-gray-500">Total: <strong>{p.total}</strong></span>
                          <span className="text-red-600">Vendus: <strong>{p.used}</strong></span>
                          <span className="text-green-600">Restants: <strong>{p.total - p.used}</strong></span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="flex flex-col overflow-hidden">
              <CardHeader className="pb-2 flex-shrink-0">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Ventes récentes</CardTitle>
                  {data.recentSales.length > 0 && (
                    <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full tabular-nums">
                      {data.recentSales.length}
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {data.recentSales.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8 px-4">Aucune vente enregistrée</p>
                ) : (
                  <div className="max-h-[360px] overflow-y-auto scroll-card">
                    <table className="w-full text-xs border-collapse">
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
                        {data.recentSales.map((v, i) => {
                          const displayPrice = v.salePrice || v.price || "";
                          const dateStr = v.usedAt ? (() => {
                            const d = new Date(v.usedAt);
                            const day = String(d.getDate()).padStart(2, "0");
                            const month = MONTHS[d.getMonth()];
                            const hh = String(d.getHours()).padStart(2, "0");
                            const mm = String(d.getMinutes()).padStart(2, "0");
                            return `${day} ${month} ${d.getFullYear()} ${hh}:${mm}`;
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
                )}
              </CardContent>
            </Card>

            <AvailableVouchersModal open={showAvailable} onClose={() => setShowAvailable(false)} vouchers={data.availableVouchers} />
          </>
        )}
      </main>
    </div>
  );
}

export default function VendorPortal() {
  const { token, vendorInfo, logout } = useAuth();

  if (!token || !vendorInfo) return null;

  const vendor: VendorInfo = {
    id: vendorInfo.id,
    name: vendorInfo.name,
    email: vendorInfo.email,
    username: vendorInfo.username,
  };

  return <Dashboard token={token} vendor={vendor} onLogout={logout} />;
}
