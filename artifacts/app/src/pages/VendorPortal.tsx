import { useState, useEffect, useCallback } from "react";
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
  User, RefreshCw, Clock, ChevronLeft, Search, Banknote, Printer,
} from "lucide-react";

const TOKEN_KEY = "vouchernet_vendor_token";
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type VendorInfo = { id: number; name: string; email: string | null; username: string | null };
type SalesStats = { todaySold: number; yesterdaySold: number; weekSold: number; lastMonthSold: number };
type ByProfile = { profileName: string; total: number; printed: number; used: number };
type Voucher = {
  id: number;
  username: string;
  password: string;
  profileName: string;
  price: string;
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

function StatCard({
  label, value, icon: Icon, color, onClick,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  color: string;
  onClick?: () => void;
}) {
  const inner = (
    <CardContent className="p-4 flex items-center gap-4">
      <div className={`h-12 w-12 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
        <Icon className="h-6 w-6 text-white" />
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-blue-600 mb-4">
            <Wifi className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">VoucherNet</h1>
          <p className="text-gray-500 text-sm mt-1">Espace vendeur</p>
        </div>
        <Card className="shadow-lg">
          <CardContent className="p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="vp-username">Nom d&apos;utilisateur</Label>
                <Input id="vp-username" className="mt-1" placeholder="votre identifiant" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus autoComplete="username" />
              </div>
              <div>
                <Label htmlFor="vp-password">Mot de passe</Label>
                <Input id="vp-password" type="password" className="mt-1" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
              </div>
              {error && <p className="text-sm text-red-600 bg-red-50 rounded-md px-3 py-2">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>{loading ? "Connexion..." : "Se connecter"}</Button>
            </form>
          </CardContent>
        </Card>
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
                    <CardTitle className="text-base">Tickets vendus ({data.total})</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {data.vouchers.length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-6">Aucune vente ce jour</p>
                    ) : (
                      <div className="space-y-1">
                        {data.vouchers.map((v) => (
                          <div key={v.id} className="flex items-center justify-between py-2.5 border-b last:border-0 gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-mono font-medium text-gray-800">{v.username}</p>
                              <p className="text-xs text-gray-400">
                                {v.profileName}{v.price ? ` — ${v.price} FCFA` : ""}
                                {v.printedAt ? ` · ${fmt(v.printedAt)}` : ""}
                              </p>
                            </div>
                            <Badge variant="outline" className="border-red-300 text-red-600 bg-transparent flex-shrink-0 text-xs">Vendu</Badge>
                          </div>
                        ))}
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
                      {data.byProfile.map((p) => (
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
                <CardHeader className="pb-2"><CardTitle className="text-base">Tickets vendus ({data.total})</CardTitle></CardHeader>
                <CardContent>
                  {data.vouchers.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-6">Aucune vente enregistrée</p>
                  ) : (
                    <div className="space-y-1">
                      {data.vouchers.map((v) => (
                        <div key={v.id} className="flex items-center justify-between py-2.5 border-b last:border-0 gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-mono font-medium text-gray-800">{v.username}</p>
                            <p className="text-xs text-gray-400">
                              {v.profileName}{v.price ? ` — ${v.price} FCFA` : ""}
                              {v.printedAt ? ` · ${fmt(v.printedAt)}` : ""}
                            </p>
                          </div>
                          <Badge variant="outline" className="border-red-300 text-red-600 bg-transparent flex-shrink-0 text-xs">Vendu</Badge>
                        </div>
                      ))}
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
                      {data.byProfile.map((p) => (
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAvailable, setShowAvailable] = useState(false);

  const now = new Date();
  const [reportDay,   setReportDay]   = useState(String(now.getDate()));
  const [reportMonth, setReportMonth] = useState(String(now.getMonth() + 1));
  const [reportYear,  setReportYear]  = useState(String(now.getFullYear()));
  const [reportView,  setReportView]  = useState<{ day: string; month: string; year: string } | null>(null);
  const [periodView,  setPeriodView]  = useState<"today" | "yesterday" | "week" | "month" | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api("/vendor-portal/me", { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401 || res.status === 403) { onLogout(); return; }
      setData(await res.json());
    } catch {
      setError("Erreur lors du chargement des données");
    } finally {
      setLoading(false);
    }
  }, [token, onLogout]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 30_000);
    return () => clearInterval(id);
  }, [fetchData]);

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
        { label: "Hier",          vendus: data.salesStats.yesterdaySold },
        { label: "Aujourd'hui",   vendus: data.salesStats.todaySold },
        { label: "Sem. dern.",    vendus: data.salesStats.weekSold },
        { label: "Mois en cours", vendus: data.salesStats.lastMonthSold },
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
          <Button size="sm" variant="ghost" onClick={fetchData} title="Actualiser">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={onLogout}>
            <LogOut className="h-4 w-4" /> Déconnexion
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
              <StatCard label="Vendus aujourd'hui"  value={data.salesStats.todaySold}      icon={ShoppingCart} color="bg-green-500"  onClick={() => setPeriodView("today")} />
              <StatCard label="Vendus hier"          value={data.salesStats.yesterdaySold}  icon={Clock}        color="bg-yellow-500" onClick={() => setPeriodView("yesterday")} />
              <StatCard label="Semaine dernière"     value={data.salesStats.weekSold}        icon={Calendar}     color="bg-orange-500" onClick={() => setPeriodView("week")} />
              <StatCard label="Mois en cours"        value={data.salesStats.lastMonthSold}   icon={TrendingUp}   color="bg-purple-500" onClick={() => setPeriodView("month")} />

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
                    <Bar dataKey="vendus" name="Vendus" fill="#3b82f6" radius={[4, 4, 0, 0]} />
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
                    {data.byProfile.map((p) => (
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

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Ventes récentes</CardTitle>
              </CardHeader>
              <CardContent>
                {data.recentSales.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">Aucune vente enregistrée</p>
                ) : (
                  <div className="space-y-2">
                    {data.recentSales.map((v) => (
                      <div key={v.id} className="flex items-center justify-between py-2 border-b last:border-0 gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-mono font-medium truncate">{v.username}</p>
                          <p className="text-xs text-gray-400">
                            {v.profileName}{v.price ? ` — ${v.price} FCFA` : ""}
                            {v.usedAt ? ` · ${fmt(v.usedAt)}` : ""}
                          </p>
                        </div>
                        <Badge variant="outline" className="border-red-300 text-red-600 bg-transparent flex-shrink-0">Vendu</Badge>
                      </div>
                    ))}
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
