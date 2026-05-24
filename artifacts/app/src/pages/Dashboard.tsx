import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import { Link, useLocation } from "wouter";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useQuery } from "@tanstack/react-query";
import { useGetDashboard, useListRouterLogs, getGetDashboardQueryKey, getListRouterLogsQueryKey } from "@workspace/api-client-react";
import { isApiPauseError } from "@workspace/api-client-react";
import { useRouterContext } from "@/contexts/RouterContext";
import { useCurrency } from "@/lib/use-currency";
import { useAuth } from "@/contexts/AuthContext";
import { usePageVisibility } from "@/hooks/use-page-visibility";
import { useRouterDashboardPriority } from "@/hooks/use-router-dashboard-priority";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, CalendarDays, Router, RefreshCw, Wifi, LogIn, LogOut, AlertCircle, Shield, Info, Cpu, HardDrive, Clock, Activity, WifiOff, UserPlus, Zap, Users } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// Dashboard-level (router-agnostic) cache — stores last successful dashboard API response.
// Used as fallback display value while data refetches in background.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _dashboardCache: { data?: any; ts?: number } = {};

type LogEntry = { id: string; time: string; topics: string; message: string };

/** Échec ping au sélecteur : afficher la page hors ligne puis rediriger. */
const PING_FAIL_REDIRECT_MS = 30_000;
const RUNTIME_OFFLINE_REDIRECT_MS = 5_000;

const DASH_LOGS_PARAMS = {
  limit: 120,
  topics: "hotspot",
  live: "1" as const,
  hotspotUsers: "1" as const,
};
const DASH_LOGS_CACHE_KEY = "vouchernet-dashboard-logs-cache:v2";
const DASH_LOGS_CACHE_TTL_MS = 60_000;

function readDashLogsCache(routerId: number | null): LogEntry[] | undefined {
  if (!routerId) return undefined;
  try {
    const raw = localStorage.getItem(`${DASH_LOGS_CACHE_KEY}:${routerId}`);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { ts?: number; logs?: LogEntry[] };
    if (!parsed?.logs?.length) return undefined;
    if (typeof parsed.ts === "number" && Date.now() - parsed.ts > DASH_LOGS_CACHE_TTL_MS) return undefined;
    return parsed.logs;
  } catch {
    return undefined;
  }
}

function writeDashLogsCache(routerId: number | null, logs: LogEntry[]) {
  if (!routerId || !logs.length) return;
  try {
    localStorage.setItem(`${DASH_LOGS_CACHE_KEY}:${routerId}`, JSON.stringify({ ts: Date.now(), logs }));
  } catch {
    // ignore quota / private mode
  }
}

interface RouterInfo {
  identity: string | null;
  boardName: string | null;
  model: string | null;
  serialNumber: string | null;
  clockDate: string | null;
  clockTime: string | null;
  routerOsVersion: string | null;
  firmwareVersion: string | null;
  cpu: string | null;
  cpuCount: string | null;
  cpuLoad: string | null;
  totalMemory: string | null;
  freeMemory: string | null;
  uptime: string | null;
  architecture: string | null;
}

function formatCpuLoad(raw: string | null | undefined): string | null {
  if (raw == null || raw === "") return null;
  const n = parseFloat(String(raw).replace("%", "").trim());
  if (!Number.isFinite(n)) return null;
  return `${Math.round(n)}%`;
}

function formatUptime(raw: string | null): string | null {
  if (!raw) return null;
  const w = parseInt(raw.match(/(\d+)w/)?.[1] ?? "0", 10);
  const d = parseInt(raw.match(/(\d+)d/)?.[1] ?? "0", 10);
  const h = parseInt(raw.match(/(\d+)h/)?.[1] ?? "0", 10);
  const m = parseInt(raw.match(/(\d+)m(?!s)/)?.[1] ?? "0", 10);
  const s = parseInt(raw.match(/(\d+)s/)?.[1] ?? "0", 10);
  const days = w * 7 + d;
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return days > 0 ? `${days}j ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
}

const MONTH_MAP: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};
function formatClockDateTime(clockDate: string | null, clockTime: string | null): string {
  let datePart = clockDate ?? "";
  if (clockDate) {
    const match = clockDate.match(/^(\w{3})\/(\d{2})\/(\d{4})$/);
    if (match) {
      const mm = MONTH_MAP[match[1].toLowerCase()] ?? "??";
      datePart = `${match[3]}-${mm}-${match[2]}`;
    }
  }
  return [datePart, clockTime].filter(Boolean).join(" ");
}

function formatMemory(bytes: string | null): string | null {
  if (!bytes) return null;
  const n = parseInt(bytes, 10);
  if (isNaN(n)) return bytes;
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GiB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(0)} MiB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KiB`;
  return `${n} B`;
}

function formatAmount(amount: number, currency = "FCFA"): string {
  if (amount === 0) return "";
  return amount.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " " + currency;
}

function amountTextStyle(amount: number, currency = "FCFA"): React.CSSProperties {
  const amountStr = amount.toLocaleString("fr-FR", { maximumFractionDigits: 0 });
  const len = `${amountStr} ${currency}`.length;
  // Zone texte mobile ≈ 29vw, desktop ≈ 19vw (1/4 viewport - padding - icône).
  // Caractère bold ≈ 0.6em → vw max = 29vw/(len×0.6) = (48.3/len)vw.
  // La classe .amount-fill applique clamp(8px, var(--awv), 20px) mobile et 22px desktop via @media.
  const vwSize = (48.3 / len).toFixed(1);
  return { '--awv': `${vwSize}vw`, lineHeight: 1.15, minWidth: 0 } as React.CSSProperties;
}

/**
 * Parse a MikroTik hotspot log message into its semantic parts.
 * Typical raw formats:
 *   "->: 1mfih2id (172.16.3.126): logged in"
 *   "1mfih2id (172.16.3.126): trying to log in by mac-cookie"
 *   "1sm6k76j (172.16.0.15): logged out: keepalive timeout"
 *   "1sm6k76j (172.16.0.15): login failed: invalid username or password"
 */
function parseHotspotMessage(raw: string | null | undefined): { user: string | null; ip: string | null; action: string } {
  if (!raw) return { user: null, ip: null, action: "" };
  const stripped = raw.replace(/^->:\s*/, "").trim();
  // Allow ANY characters (incl. spaces and accents) for the username, then a
  // strict IPv4 in parens, then ":" + action. Examples that must parse:
  //   "1mfih2id (172.16.3.126): logged in"
  //   "Famille Koné (172.16.4.163): logged out: keepalive timeout"
  const m = stripped.match(/^(.+?)\s*\(((?:\d{1,3}\.){3}\d{1,3})\):\s*(.*)$/);
  if (m) return { user: m[1].trim(), ip: m[2], action: normalizeAction(m[3] || stripped) };
  return { user: null, ip: null, action: normalizeAction(stripped) };
}

/**
 * Normalise an action substring to the MikHmon-style wording the user expects:
 *   "trying to log in by mac-cookie" → "log in by mac-cookie"
 *   "logged in"                       → "log in"
 *   "logged out: keepalive timeout"   → "logged out keepalive timeout"
 *   "login failed: invalid username..."→ "login failed invalid username..."
 */
function normalizeAction(action: string): string {
  let a = action.trim();
  a = a.replace(/^trying to log in by\s+/i, "log in by ");
  a = a.replace(/^logged out:\s*/i, "logged out ");
  a = a.replace(/^login failed:\s*/i, "login failed ");
  if (/^logged in$/i.test(a)) a = "log in";
  return a;
}

/** Coupe `time` du routeur (ex. "05-12 23:16:32") sur le dernier espace pour tenir en colonne étroite sans chevauchement. */
function splitLogTimeForDisplay(time: string): { first: string; second: string | null } {
  const t = (time ?? "").trim();
  if (!t) return { first: "", second: null };
  const i = t.lastIndexOf(" ");
  if (i <= 0 || i >= t.length - 1) return { first: t, second: null };
  return { first: t.slice(0, i), second: t.slice(i + 1) };
}

function classifyLog(entry: LogEntry): {
  icon: React.ReactNode;
  rowClass: string;
  timeClass: string;
} {
  const msg = entry.message.toLowerCase();
  const topics = entry.topics.toLowerCase();

  if (topics.includes("error") || topics.includes("critical")) {
    return {
      icon: <AlertCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0 mt-0.5" />,
      rowClass: "bg-red-50/60 hover:bg-red-50",
      timeClass: "text-red-400",
    };
  }
  if (msg.includes("logged in") || msg.includes("login")) {
    return {
      icon: <LogIn className="h-3.5 w-3.5 text-green-500 flex-shrink-0 mt-0.5" />,
      rowClass: "hover:bg-gray-50",
      timeClass: "text-gray-400",
    };
  }
  if (msg.includes("logged out") || msg.includes("logout") || msg.includes("disconnected")) {
    return {
      icon: <LogOut className="h-3.5 w-3.5 text-orange-400 flex-shrink-0 mt-0.5" />,
      rowClass: "hover:bg-gray-50",
      timeClass: "text-gray-400",
    };
  }
  if (topics.includes("warning") || msg.includes("denied") || msg.includes("block")) {
    return {
      icon: <Shield className="h-3.5 w-3.5 text-yellow-500 flex-shrink-0 mt-0.5" />,
      rowClass: "bg-yellow-50/40 hover:bg-yellow-50/60",
      timeClass: "text-yellow-500",
    };
  }
  return {
    icon: <Info className="h-3.5 w-3.5 text-blue-400 flex-shrink-0 mt-0.5" />,
    rowClass: "hover:bg-gray-50",
    timeClass: "text-gray-400",
  };
}


function formatBps(bps: number): string {
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`;
  if (bps >= 1_000)     return `${Math.round(bps / 1_000)} Kbps`;
  return `${bps} bps`;
}

const MAX_TRAFFIC_POINTS = 30;

const TX_COLOR   = "#4dd0e1";
const RX_COLOR   = "#f48fb1";
const LIGHT_GRID = "#e5e7eb";

function fmtTime(ts: number) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

// Base-1024 formatter — same as MikHmon Highcharts yAxis.labels.formatter
function yTickFmt(v: number) {
  if (v === 0) return "0 bps";
  const sizes = ["bps", "kbps", "Mbps", "Gbps", "Tbps"];
  const i = Math.floor(Math.log(v) / Math.log(1024));
  return `${parseFloat((v / Math.pow(1024, i)).toFixed(2))} ${sizes[i]}`;
}

/** Ferme le tooltip Recharts au tap hors graphique ou au scroll (mobile). */
function useDismissibleChartTooltip() {
  const chartRef = useRef<HTMLDivElement>(null);
  const [suppressTooltip, setSuppressTooltip] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (touch) touchStartRef.current = { x: touch.clientX, y: touch.clientY };
      const target = e.target as Node;
      if (chartRef.current?.contains(target)) {
        setSuppressTooltip(false);
      } else {
        setSuppressTooltip(true);
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      const start = touchStartRef.current;
      if (!touch || !start) return;
      if (Math.abs(touch.clientX - start.x) > 8 || Math.abs(touch.clientY - start.y) > 8) {
        setSuppressTooltip(true);
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!chartRef.current?.contains(target)) setSuppressTooltip(true);
    };

    document.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    document.addEventListener("touchmove", onTouchMove, { capture: true, passive: true });
    document.addEventListener("mousedown", onMouseDown, { capture: true });
    return () => {
      document.removeEventListener("touchstart", onTouchStart, { capture: true });
      document.removeEventListener("touchmove", onTouchMove, { capture: true });
      document.removeEventListener("mousedown", onMouseDown, { capture: true });
    };
  }, []);

  const onChartMouseMove = useCallback((state: { isTooltipActive?: boolean } | null) => {
    if (state?.isTooltipActive) setSuppressTooltip(false);
  }, []);

  const onChartMouseLeave = useCallback(() => {
    setSuppressTooltip(true);
  }, []);

  return { chartRef, suppressTooltip, onChartMouseMove, onChartMouseLeave };
}

function TrafficMonitorCard({ routerId, enabled = true }: { routerId: number | null; enabled?: boolean }) {
  const isVisible = usePageVisibility();
  const { token: authToken } = useAuth();
  const { chartRef, suppressTooltip, onChartMouseMove, onChartMouseLeave } = useDismissibleChartTooltip();
  const [history, setHistory] = useState<{ t: number; rx: number; tx: number }[]>([]);
  const [selectedIface, setSelectedIface] = useState<string>("");

  const authHeaders: HeadersInit = authToken ? { Authorization: `Bearer ${authToken}` } : [];

  // Fetch interface list when router changes — gated on tab visibility
  // NOTE: on accepte un petit retry quand la requête est annulée par la pause API
  // (retour d'arrière-plan APK), sinon la liste reste vide jusqu'au prochain mount.
  const { data: ifaceList, refetch: refetchIfaces } = useQuery<{ name: string; type: string; disabled: boolean }[]>({
    queryKey: ["interfaces", routerId],
    queryFn: async ({ signal }) => {
      const res = await fetch(`${BASE}/api/routers/${routerId}/interfaces`, { signal, headers: authHeaders });
      if (!res.ok) throw new Error("interfaces unavailable");
      return res.json();
    },
    enabled: isVisible && !!routerId && enabled,
    staleTime: 60_000,
    retry: (failureCount, err) => isApiPauseError(err) && failureCount < 3,
    throwOnError: false,
  });

  // Auto-select ether1 by default, fallback to first non-disabled interface
  useEffect(() => {
    if (!ifaceList?.length) return;
    setSelectedIface(prev => {
      if (prev && ifaceList.some(i => i.name === prev)) return prev;
      const ether1 = ifaceList.find(i => i.name === "ether1" && !i.disabled);
      if (ether1) return ether1.name;
      return ifaceList.find(i => !i.disabled)?.name ?? ifaceList[0].name ?? "";
    });
  }, [ifaceList]);

  const trafficUrl = routerId
    ? `${BASE}/api/routers/${routerId}/traffic?live=1${selectedIface ? `&iface=${encodeURIComponent(selectedIface)}` : ""}`
    : "";

  const { data, isError, refetch: refetchTraffic } = useQuery<{ rxBps: number; txBps: number; name: string | null }>({
    queryKey: ["traffic", routerId, selectedIface],
    queryFn: async ({ signal }) => {
      const res = await fetch(trafficUrl, { signal, headers: authHeaders });
      if (!res.ok) throw new Error("traffic unavailable");
      return res.json();
    },
    // Gated sur la visibilité : pause quand onglet caché / navigateur minimisé.
    enabled: isVisible && !!routerId && enabled,
    refetchInterval: isVisible ? 3_000 : false,
    refetchIntervalInBackground: false,
    staleTime: 1_500,
    // Quelques retries quand la requête est annulée par la pause API (retour APK)
    // sinon la carte reste bloquée sur "Connexion au routeur…" jusqu'au prochain tick.
    retry: (failureCount, err) => isApiPauseError(err) && failureCount < 3,
    throwOnError: false,
  });

  useEffect(() => {
    if (!data) return;
    setHistory(prev => [...prev, { t: Date.now(), rx: data.rxBps, tx: data.txBps }].slice(-MAX_TRAFFIC_POINTS));
  }, [data]);

  // Reset l'historique seulement quand le routeur change OU quand l'interface
  // est volontairement changée vers une autre valeur non-vide. On évite ainsi
  // d'effacer le graphique pendant le bootstrap (selectedIface "" → "ether1")
  // ou un re-render transitoire après reprise.
  const lastResetKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!routerId) {
      if (lastResetKeyRef.current !== null) {
        lastResetKeyRef.current = null;
        setHistory([]);
      }
      return;
    }
    if (!selectedIface) return;
    const key = `${routerId}:${selectedIface}`;
    if (lastResetKeyRef.current !== null && lastResetKeyRef.current !== key) {
      setHistory([]);
    }
    lastResetKeyRef.current = key;
  }, [routerId, selectedIface]);

  // Forcer un refetch immédiat quand l'onglet redevient visible / le router se ré-active
  // (retour d'arrière-plan APK ou onglet caché). Évite d'attendre jusqu'à 3 s pour la
  // prochaine itération du refetchInterval.
  const canFetch = isVisible && !!routerId && enabled;
  useEffect(() => {
    if (!canFetch) return;
    void refetchTraffic();
    if (!ifaceList?.length) void refetchIfaces();
  }, [canFetch, selectedIface, refetchTraffic, refetchIfaces, ifaceList?.length]);

  const maxVal = Math.max(...history.flatMap(p => [p.rx, p.tx]), 1);
  const yTop = maxVal * 1.5;

  const yTicks = [0, yTop * 0.333, yTop * 0.667, yTop];

  return (
    <Card className="flex flex-col flex-1 min-w-0 min-h-[300px] lg:min-h-0">
      <CardHeader className="pb-2 lg:pb-1 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-gray-400" />
            Trafic
            {routerId && selectedIface && !isError && (
              <span className="flex items-center gap-1 text-xs font-normal text-green-600">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                </span>
                Live
              </span>
            )}
            {routerId && selectedIface && isError && history.length > 0 && (
              <span className="flex items-center gap-1 text-xs font-normal text-amber-600">
                <RefreshCw className="h-3 w-3 animate-spin" />
                Reconnexion…
              </span>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            {ifaceList && ifaceList.length > 0 && (
              <select
                value={selectedIface}
                onChange={(e) => setSelectedIface(e.target.value)}
                className="text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white text-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-300"
              >
                {ifaceList.map((iface) => (
                  <option key={iface.name} value={iface.name} disabled={iface.disabled}>
                    {iface.name}
                  </option>
                ))}
              </select>
            )}
            <span className="text-xs text-gray-400">↻ 3s</span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col flex-1 pt-3 pb-2 px-3 lg:pt-1.5 lg:pb-1 lg:px-2" style={{ minHeight: 0 }}>
        {!routerId ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2">
            <Activity className="h-8 w-8 text-gray-200" />
            <p className="text-xs text-gray-400">Sélectionnez un routeur</p>
          </div>
        ) : history.length > 0 ? (
          // Une fois qu'on a des points, on garde le graphique visible même
          // pendant une erreur transitoire (pause API, retour d'arrière-plan,
          // perte momentanée du routeur). Le badge « Reconnexion… » informe
          // l'utilisateur. On bascule sur « Indisponible » uniquement quand on
          // n'a jamais reçu de données.
          <div className="flex flex-col flex-1" style={{ minHeight: 0 }}>
            {selectedIface && (
              <p className="hidden">Interface {selectedIface}</p>
            )}
            {/* position:relative wrapper is the recharts trick to fill flex space with height="100%" */}
            <div ref={chartRef} className="flex-1" style={{ position: "relative", minHeight: 220 }}>
              <ResponsiveContainer width="100%" height="100%" minHeight={220}>
                <LineChart
                  data={history}
                  margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                  onMouseMove={onChartMouseMove}
                  onMouseLeave={onChartMouseLeave}
                >
                  <CartesianGrid stroke={LIGHT_GRID} strokeDasharray="0" vertical={true} horizontal={true} />
                  <XAxis
                    dataKey="t"
                    tickFormatter={fmtTime}
                    interval="preserveStartEnd"
                    tick={{ fill: "#9ca3af", fontSize: 10 }}
                    axisLine={{ stroke: LIGHT_GRID }}
                    tickLine={false}
                    minTickGap={60}
                  />
                  <YAxis
                    domain={[0, yTop]}
                    ticks={yTicks}
                    tickFormatter={yTickFmt}
                    tick={{ fill: "#9ca3af", fontSize: 10 }}
                    axisLine={{ stroke: LIGHT_GRID }}
                    tickLine={false}
                    width={66}
                  />
                  <Tooltip
                    active={suppressTooltip ? false : undefined}
                    isAnimationActive={false}
                    contentStyle={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 6, fontSize: 11, color: "#374151" }}
                    labelFormatter={(v) => fmtTime(v as number)}
                    formatter={(value, name) => [formatBps(value as number), name === "rx" ? "Rx" : "Tx"]}
                  />
                  <Legend
                    wrapperStyle={{ paddingTop: 8, fontSize: 12, color: "#6b7280" }}
                    formatter={(v) => v === "rx" ? "Rx" : "Tx"}
                  />
                  <Line type="monotone" dataKey="rx" stroke={RX_COLOR} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="tx" stroke={TX_COLOR} strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : isError ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2">
            <Activity className="h-8 w-8 text-red-200" />
            <p className="text-xs text-red-400">Indisponible</p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-2">
            <RefreshCw className="h-8 w-8 text-gray-300 animate-spin" />
            <p className="text-xs text-gray-400">Connexion au routeur…</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const isVisible = usePageVisibility();

  const { selectedRouterId, pingTrigger, setRouterOnline, setRouterIdentity, isPingFailed, setIsPingFailed } =
    useRouterContext();
  const currency = useCurrency();

  const { data: _freshData, isLoading, isFetching: dashFetching, isError, refetch } = useGetDashboard({
    query: {
      queryKey: getGetDashboardQueryKey(),
      enabled: isVisible && !isPingFailed,
      // DB-only, pas de MikroTik — on garde le polling mais on le stoppe si onglet caché.
      refetchInterval: isVisible && !isPingFailed ? 10_000 : false,
      staleTime: 9_000,
      gcTime: 30 * 60_000,
      refetchIntervalInBackground: false,
    },
  });

  // Update module cache whenever fresh data arrives
  useEffect(() => {
    if (_freshData) { _dashboardCache.data = _freshData; _dashboardCache.ts = Date.now(); }
  }, [_freshData]);

  // Display data: fresh from React Query OR last cached value — never undefined after first load
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = isPingFailed ? undefined : (_freshData ?? _dashboardCache.data);
  const [pingRedirectSecondsLeft, setPingRedirectSecondsLeft] = useState(
    Math.ceil(PING_FAIL_REDIRECT_MS / 1000),
  );
  const [enableSecondaries, setEnableSecondaries] = useState(false);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const prevIdsRef = useRef<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);

  // ── MikroTik offline detection ─────────────────────────────────────────────
  const [showErrorPage, setShowErrorPage] = useState(false);
  const mikFailCountRef = useRef(0);
  const mikLastFailTsRef = useRef(0);
  const mikLastSuccessTsRef = useRef(0);
  // ─────────────────────────────────────────────────────────────────────────────

  const {
    livePriority,
    sales,
    salesKpiReady,
    sseConnected,
    priorityLoading,
    priorityUpdatedAt,
    priorityQueryFetching,
    priorityIsError,
    priorityErrorUpdatedAt,
    refetchPriority,
    liveSnapshotAgeMs,
  } = useRouterDashboardPriority(isPingFailed ? null : selectedRouterId);

  // Stable callback — uses refs to avoid stale closures
  const handleMikrotikFailure = useCallback(() => {
    const now = Date.now();
    if (now - mikLastFailTsRef.current < 10_000) return; // debounce: 1 failure per 10s max
    mikLastFailTsRef.current = now;
    mikFailCountRef.current += 1;
    const n = mikFailCountRef.current;
    if (n === 1) {
      toast.warning("Impossible de contacter le MikroTik", {
        id: "mikrotik-status",
        duration: 3000,
      });
    } else {
      toast.error("Impossible de récupérer les infos du routeur", {
        id: "mikrotik-status",
        description: "MikroTik éteint ou hors ligne !!!",
        duration: 6000,
      });
    }
    if (n >= 3) {
      setShowErrorPage(true);
    }
  }, []);

  const [, navigate] = useLocation();

  const goToRoutersFromPingFail = useCallback(() => {
    setIsPingFailed(false);
    setShowErrorPage(false);
    toast.error("Hors ligne", {
      id: "router-ping-redirect",
      description:
        "Le routeur sélectionné ne répond pas. Vérifiez l’alimentation ou la connexion du MikroTik.",
      duration: 8000,
    });
    navigate("/routers");
  }, [navigate, setIsPingFailed]);

  const handleMikrotikRecovery = useCallback(() => {
    const now = Date.now();
    if (now - mikLastSuccessTsRef.current < 3_000) return; // debounce recovery
    mikLastSuccessTsRef.current = now;
    mikFailCountRef.current = 0;
    mikLastFailTsRef.current = 0;
    setShowErrorPage(false);
    setIsPingFailed(false);
    toast.dismiss("mikrotik-status");
  }, [setIsPingFailed]);

  // Ping sélecteur échoué : page hors ligne 30 s puis /routeurs + toast explicite
  useEffect(() => {
    if (!isPingFailed) return;
    setPingRedirectSecondsLeft(Math.ceil(PING_FAIL_REDIRECT_MS / 1000));
    const tick = window.setInterval(() => {
      setPingRedirectSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    const t = window.setTimeout(() => {
      goToRoutersFromPingFail();
    }, PING_FAIL_REDIRECT_MS);
    return () => {
      clearTimeout(t);
      clearInterval(tick);
    };
  }, [isPingFailed, goToRoutersFromPingFail]);

  // Perte de connexion en cours d’utilisation : redirection plus courte
  useEffect(() => {
    if (!showErrorPage || isPingFailed) return;
    const t = window.setTimeout(() => {
      setShowErrorPage(false);
      toast.warning("Connexion MikroTik perdue", {
        id: "router-runtime-redirect",
        description: "Redirection vers la liste des routeurs.",
        duration: 6000,
      });
      navigate("/routers");
    }, RUNTIME_OFFLINE_REDIRECT_MS);
    return () => clearTimeout(t);
  }, [showErrorPage, isPingFailed, navigate]);

  useEffect(() => {
    if (!selectedRouterId || !livePriority) return;
    setRouterOnline(true);
    handleMikrotikRecovery();
  }, [selectedRouterId, livePriority, setRouterOnline, handleMikrotikRecovery]);

  const activeSessions = livePriority?.sessionsCount;
  const usersStats = livePriority?.users;
  const hotspotUserCount = usersStats?.total ?? usersStats?.available;
  const dbSales = {
    dailyCount: Number(data?.dailySalesCount ?? 0),
    dailyAmount: Number(data?.dailySalesAmount ?? 0),
    monthlyCount: Number(data?.monthlySalesCount ?? 0),
    monthlyAmount: Number(data?.monthlySalesAmount ?? 0),
  };
  const hasDbSales =
    data != null &&
    typeof data.dailySalesCount === "number" &&
    typeof data.dailySalesAmount === "number" &&
    typeof data.monthlySalesCount === "number" &&
    typeof data.monthlySalesAmount === "number";
  const avail = livePriority?.availability;
  /** KPI prêt : l’API confirme la métrique — un vrai 0 s’affiche, pas un skeleton infini. */
  const sessionsKpiReady =
    !!selectedRouterId && !!livePriority && avail?.sessionsKnown === true;
  const usersKpiReady =
    !!selectedRouterId &&
    !!livePriority &&
    (avail?.usersKnown === true || avail == null);
  const cardSales = selectedRouterId
    ? (salesKpiReady && sales
      ? {
          dailyCount: sales.dailyCount,
          dailyAmount: sales.dailyAmount,
          monthlyCount: sales.monthlyCount,
          monthlyAmount: sales.monthlyAmount,
        }
      : null)
    : dbSales;
  const infoKpiReady =
    !!selectedRouterId && !!livePriority && avail?.infoKnown === true;
  const routerInfo = (livePriority?.info ?? null) as RouterInfo | null;
  const cpuLoadLabel = formatCpuLoad(routerInfo?.cpuLoad ?? null);
  const infoLoading = !!selectedRouterId && !infoKpiReady && (priorityLoading || !livePriority);
  const isLiveSnapshotStale = liveSnapshotAgeMs != null && liveSnapshotAgeMs > 10_000;
  const sessionsFetching = (!sseConnected || isLiveSnapshotStale) && priorityQueryFetching;
  const usersFetching = (!sseConnected || isLiveSnapshotStale) && priorityQueryFetching;
  const salesFetching = (!sseConnected || isLiveSnapshotStale) && priorityQueryFetching;

  const priorityReady =
    !!selectedRouterId && sessionsKpiReady && usersKpiReady && salesKpiReady && infoKpiReady;

  useEffect(() => {
    if (!selectedRouterId) {
      setEnableSecondaries(false);
      return;
    }
    if (priorityReady) {
      setEnableSecondaries(true);
      return;
    }
    const t = setTimeout(() => setEnableSecondaries(true), 1200);
    return () => clearTimeout(t);
  }, [selectedRouterId, priorityReady]);

  const {
    data: logs = [],
    isLoading: logsLoading,
    isFetching: logsFetching,
    refetch: refetchLogs,
    error: logsError,
  } = useListRouterLogs(
    selectedRouterId ?? 0,
    DASH_LOGS_PARAMS,
    {
      query: {
        queryKey: getListRouterLogsQueryKey(selectedRouterId ?? 0, DASH_LOGS_PARAMS),
        // Gated : aucune requête logs si onglet caché, pas de routeur, ou pas encore prêt.
        enabled: isVisible && !!selectedRouterId && enableSecondaries && !isPingFailed,
        // Logs live : 10s — serveur cache à 4s (MIK_TTL.logs), polling plus fréquent = inutile.
        // Stopper le polling si onglet caché (isVisible = false → enabled = false suffit).
        refetchInterval: isVisible ? 10_000 : false,
        refetchIntervalInBackground: false,
        staleTime: 800,
        initialData: readDashLogsCache(selectedRouterId),
        initialDataUpdatedAt: readDashLogsCache(selectedRouterId) ? Date.now() : undefined,
      },
    },
  );

  useEffect(() => {
    if (!logs.length) return;
    writeDashLogsCache(selectedRouterId, logs);
    const incoming = new Set(logs.map((l) => l.id).filter(Boolean));
    const fresh = new Set([...incoming].filter((id) => !prevIdsRef.current.has(id)));
    if (fresh.size > 0 && prevIdsRef.current.size > 0) {
      setNewIds(fresh);
      setTimeout(() => setNewIds(new Set()), 2000);
    }
    prevIdsRef.current = incoming;
  }, [logs]);

  // ── Online indicator driven by real data ──────────────────────────────────
  // Track timestamp of the last successful data receive from MikroTik
  const lastSuccessRef = useRef<number>(0);

  // Sessions success → green
  useEffect(() => {
    if (!selectedRouterId || priorityUpdatedAt === 0) return;
    lastSuccessRef.current = Math.max(lastSuccessRef.current, priorityUpdatedAt);
    setRouterOnline(true);
  }, [priorityUpdatedAt, selectedRouterId, setRouterOnline]);

  // Logs success → green
  useEffect(() => {
    if (!selectedRouterId) return;
    if (!logsFetching && logs.length > 0) {
      lastSuccessRef.current = Date.now();
      setRouterOnline(true);
    }
  }, [logs, logsFetching, selectedRouterId, setRouterOnline]);

  // Stale detector: if no successful data for 45s → red
  useEffect(() => {
    if (!selectedRouterId) return;
    const interval = setInterval(() => {
      if (lastSuccessRef.current > 0 && Date.now() - lastSuccessRef.current > 45_000) {
        setRouterOnline(false);
      }
    }, 5_000);
    return () => clearInterval(interval);
  }, [selectedRouterId, setRouterOnline]);

  // Reset tracker when router changes
  useEffect(() => {
    lastSuccessRef.current = 0;
  }, [selectedRouterId]);
  // ─────────────────────────────────────────────────────────────────────────

  // ── MikroTik offline effects ───────────────────────────────────────────────
  // Count HTTP poll failures (each time errorUpdatedAt advances)
  const prevPriorityErrorTsRef = useRef(0);
  useEffect(() => {
    if (!selectedRouterId || !priorityIsError) return;
    if (priorityErrorUpdatedAt <= prevPriorityErrorTsRef.current) return;
    prevPriorityErrorTsRef.current = priorityErrorUpdatedAt;
    handleMikrotikFailure();
  }, [selectedRouterId, priorityIsError, priorityErrorUpdatedAt, handleMikrotikFailure]);

  // Recovery from HTTP poll success
  useEffect(() => {
    if (!selectedRouterId || priorityUpdatedAt <= 0) return;
    handleMikrotikRecovery();
  }, [selectedRouterId, priorityUpdatedAt, handleMikrotikRecovery]);

  // Reset all failure state when router changes
  useEffect(() => {
    mikFailCountRef.current = 0;
    mikLastFailTsRef.current = 0;
    mikLastSuccessTsRef.current = 0;
    setShowErrorPage(false);
    setEnableSecondaries(false);
    toast.dismiss("mikrotik-status");
  }, [selectedRouterId]);
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (routerInfo?.identity) setRouterIdentity(routerInfo.identity);
  }, [routerInfo, setRouterIdentity]);

  const prevPingTriggerRef = useRef(0);
  useEffect(() => {
    if (pingTrigger === 0) return;
    if (pingTrigger === prevPingTriggerRef.current) return;
    prevPingTriggerRef.current = pingTrigger;
    refetch();
    refetchLogs();
    refetchPriority();
  }, [pingTrigger, refetch, refetchLogs, refetchPriority]);

  const handleRefresh = () => {
    if (isPingFailed) return;
    refetch();
    if (selectedRouterId) {
      refetchLogs();
      refetchPriority();
    }
  };

  const showOfflineOverlay = (showErrorPage || isPingFailed) && !!selectedRouterId;


  return (
    <div className="relative min-h-[420px]">
      <div className={showOfflineOverlay ? "invisible pointer-events-none h-0 overflow-hidden" : undefined}>
      <div className="flex items-center justify-between mb-3 lg:mb-1">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tableau de bord</h1>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          className="text-gray-500"
        >
          <RefreshCw className={`h-4 w-4 ${(!sseConnected && priorityQueryFetching) ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {selectedRouterId && (
        <div className="mb-6 lg:mb-2">
          {infoLoading ? (
            <div className="flex flex-wrap items-center gap-2">
              <Skeleton className="h-6 w-36 rounded-full" />
              <Skeleton className="h-6 w-28 rounded-full" />
              <Skeleton className="h-6 w-32 rounded-full" />
            </div>
          ) : routerInfo ? (
            <div className="grid grid-cols-3 gap-1 justify-items-start sm:flex sm:flex-wrap sm:items-center sm:gap-2">
              {(routerInfo.boardName || routerInfo.model) && (
                <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-blue-50 border border-blue-100 text-[10px] sm:text-xs font-medium text-blue-700 overflow-hidden">
                  <Router className="h-2.5 w-2.5 sm:h-3 sm:w-3 flex-shrink-0" />
                  <span className="truncate min-w-0">{routerInfo.boardName ?? routerInfo.model}</span>
                </span>
              )}
              {routerInfo.routerOsVersion && (
                <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-violet-50 border border-violet-100 text-[10px] sm:text-xs font-medium text-violet-700 overflow-hidden">
                  <Shield className="h-2.5 w-2.5 sm:h-3 sm:w-3 flex-shrink-0" />
                  <span className="truncate min-w-0">ROS {routerInfo.routerOsVersion}</span>
                </span>
              )}
              {routerInfo.cpu && (
                <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-amber-50 border border-amber-100 text-[10px] sm:text-xs font-medium text-amber-700 overflow-hidden">
                  <Cpu className="h-2.5 w-2.5 sm:h-3 sm:w-3 flex-shrink-0" />
                  <span className="truncate min-w-0">
                    {routerInfo.cpu}
                    {routerInfo.cpuCount && routerInfo.cpuCount !== "1" ? ` ×${routerInfo.cpuCount}` : ""}
                    {cpuLoadLabel ? ` · ${cpuLoadLabel}` : ""}
                  </span>
                </span>
              )}
              {(routerInfo.freeMemory || routerInfo.totalMemory) && (
                <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-green-50 border border-green-100 text-[10px] sm:text-xs font-medium text-green-700 overflow-hidden">
                  <HardDrive className="h-2.5 w-2.5 sm:h-3 sm:w-3 flex-shrink-0" />
                  <span className="truncate min-w-0">{formatMemory(routerInfo.freeMemory)}/{formatMemory(routerInfo.totalMemory)}</span>
                </span>
              )}
              {routerInfo.uptime && (
                <span
                  className="flex items-center gap-1 px-2 py-1 rounded-full bg-sky-50 border border-sky-100 text-[10px] sm:text-xs font-medium text-sky-700 overflow-hidden"
                  title="Temps d'activité (uptime routeur)"
                >
                  <Activity className="h-2.5 w-2.5 sm:h-3 sm:w-3 flex-shrink-0" aria-hidden />
                  <span className="truncate min-w-0">{formatUptime(routerInfo.uptime)}</span>
                </span>
              )}
              {(routerInfo.clockDate || routerInfo.clockTime) && (
                <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-gray-50 border border-gray-200 text-[10px] sm:text-xs font-medium text-gray-600 overflow-hidden">
                  <Clock className="h-2.5 w-2.5 sm:h-3 sm:w-3 flex-shrink-0" />
                  <span className="truncate min-w-0">{formatClockDateTime(routerInfo.clockDate, routerInfo.clockTime)}</span>
                </span>
              )}
            </div>
          ) : null}
        </div>
      )}

      {isError && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 text-sm">
          Impossible de charger les statistiques.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 lg:[grid-template-rows:4.75rem_4.75rem_300px] gap-1 sm:gap-4 lg:gap-2 mb-3">
        <StatCard
          title="Clients actifs"
          value={
            selectedRouterId && sessionsKpiReady && typeof activeSessions === "number"
              ? activeSessions
              : undefined
          }
          live={!!selectedRouterId}
          fetching={sessionsFetching}
          icon={<Wifi className="h-5 w-5 text-purple-500" />}
          iconBg="bg-purple-100"
          loading={
            !!selectedRouterId &&
            (!sessionsKpiReady || typeof activeSessions !== "number")
          }
          href="/sessions"
        />
        <StatCard
          title="Vendu aujourd'hui"
          label={cardSales ? formatAmount(cardSales.dailyAmount, currency) : undefined}
          amountValue={cardSales?.dailyAmount}
          currency={currency}
          sub={cardSales ? `${cardSales.dailyCount.toLocaleString()} tickets vendus` : undefined}
          live={!!selectedRouterId}
          fetching={salesFetching}
          icon={<CalendarDays className="h-5 w-5 text-orange-500" />}
          iconBg="bg-orange-100"
          loading={selectedRouterId ? !salesKpiReady : (isLoading && !hasDbSales)}
          href="/sales/daily"
        />
        <StatCard
          title="Vente mensuelle"
          label={cardSales ? formatAmount(cardSales.monthlyAmount, currency) : undefined}
          amountValue={cardSales?.monthlyAmount}
          currency={currency}
          sub={cardSales ? `${cardSales.monthlyCount.toLocaleString()} tickets vendus` : undefined}
          live={!!selectedRouterId}
          fetching={salesFetching}
          icon={<TrendingUp className="h-5 w-5 text-green-500" />}
          iconBg="bg-green-100"
          loading={selectedRouterId ? !salesKpiReady : (isLoading && !hasDbSales)}
          href="/sales/monthly"
          className="order-4 lg:order-3"
        />
        <StatCard
          title="Utilisateur(s) Hotspot"
          value={
            selectedRouterId && usersKpiReady && typeof hotspotUserCount === "number"
              ? hotspotUserCount
              : undefined
          }
          live={!!selectedRouterId}
          fetching={usersFetching}
          icon={<Users className="h-5 w-5 text-blue-500" />}
          iconBg="bg-blue-100"
          loading={
            !!selectedRouterId &&
            (!usersKpiReady || typeof hotspotUserCount !== "number")
          }
          className="order-3 lg:order-4"
          href="/vouchers"
        />
        {/* Raccourcis actions — sm/md uniquement (caché sur lg) */}
        <div className="col-span-2 lg:hidden order-5 flex flex-row gap-1 items-stretch h-[4.75rem]">
          <button
            type="button"
            style={{flex:1, minWidth:0, textAlign:"left"}}
            onClick={() => window.dispatchEvent(new CustomEvent("open-add-client-dialog"))}
          >
            <Card className="h-full flex flex-col cursor-pointer hover:shadow-md transition-shadow active:scale-95">
              <div className="flex-1 flex items-center gap-2 p-2.5">
                <div className="p-1.5 bg-emerald-100 rounded-xl flex-shrink-0">
                  <UserPlus className="h-5 w-5 text-emerald-600" />
                </div>
                <p className="text-[13px] font-bold text-gray-700 whitespace-nowrap leading-none">Ajouter un client</p>
              </div>
            </Card>
          </button>
          <Link href="/generate" style={{flex:1, minWidth:0, display:"block"}}>
            <Card className="h-full flex flex-col cursor-pointer hover:shadow-md transition-shadow active:scale-95">
              <div className="flex-1 flex items-center gap-2 p-2.5">
                <div className="p-1.5 bg-amber-100 rounded-xl flex-shrink-0">
                  <Zap className="h-5 w-5 text-amber-500" />
                </div>
                <p className="text-[13px] font-bold text-gray-700 whitespace-nowrap leading-none">Générer un ticket</p>
              </div>
            </Card>
          </Link>
        </div>

        {/* ── Raccourcis desktop : Ajouter un client (col 1) — lg seulement ── */}
        <button
          type="button"
          className="hidden lg:flex h-full text-left w-full"
          onClick={() => window.dispatchEvent(new CustomEvent("open-add-client-dialog"))}
        >
          <Card className="h-full w-full flex flex-col cursor-pointer hover:shadow-md transition-shadow">
            <div className="flex-1 flex items-center gap-2.5 lg:px-4 lg:py-2.5">
              <div className="p-2 bg-emerald-100 rounded-lg flex-shrink-0">
                <UserPlus className="h-5 w-5 text-emerald-600" />
              </div>
              <div className="min-w-0">
                <p className="font-bold text-gray-900 text-sm">Ajouter un client</p>
              </div>
            </div>
          </Card>
        </button>
        {/* ── Raccourcis desktop : Générer un ticket (col 2) — lg seulement ── */}
        <Link href="/generate" className="hidden lg:flex h-full w-full">
          <Card className="h-full w-full flex flex-col cursor-pointer hover:shadow-md transition-shadow">
            <div className="flex-1 flex items-center gap-2.5 lg:px-4 lg:py-2.5">
              <div className="p-2 bg-amber-100 rounded-lg flex-shrink-0">
                <Zap className="h-5 w-5 text-amber-500" />
              </div>
              <div className="min-w-0">
                <p className="font-bold text-gray-900 text-sm">Générer un ticket</p>
              </div>
            </div>
          </Card>
        </Link>
        {/* ── Trafic : desktop cols 1-2 row 3, mobile pleine largeur ── */}
        <div className="col-span-2 order-6 lg:col-start-1 lg:row-start-3 flex flex-col lg:h-[300px]">
          <TrafficMonitorCard routerId={selectedRouterId} enabled={enableSecondaries} />
        </div>
        {/* ── Log hotspot : desktop cols 3-4 rows 2-3, mobile pleine largeur ── */}
        <div className="col-span-2 order-7 lg:col-start-3 lg:row-start-2 lg:row-span-2 flex flex-col lg:h-[384px]">
        <Card className="flex-1 min-w-0 lg:h-full lg:overflow-hidden">
        <CardHeader className="pb-2 lg:pb-0 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <span className="whitespace-nowrap">Logs hotspot</span>
              {selectedRouterId && !logsLoading && (
                <span className="flex items-center gap-1 text-xs font-normal text-green-600">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                  </span>
                  Live
                </span>
              )}
            </CardTitle>
                <span className="text-xs text-gray-400">↻ 10s</span>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {!selectedRouterId ? (
            <div className="py-14 text-center">
              <Wifi className="h-8 w-8 text-gray-200 mx-auto mb-2" />
              <p className="text-sm text-gray-400">Sélectionnez un routeur dans la barre de gauche</p>
            </div>
          ) : logsLoading ? (
            <div className="py-10 text-center text-sm text-gray-400 flex items-center justify-center gap-2">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Connexion au routeur…
            </div>
          ) : logsError ? (
            <div className="py-10 text-center text-sm text-red-400">
              Impossible de récupérer les logs de session hotspot.
            </div>
          ) : logs.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400">
              Aucune entrée de connexion / déconnexion récente.
            </div>
          ) : (
            <div
              ref={listRef}
              className="max-h-[320px] overflow-auto"
            >
              <table className="w-full table-fixed text-xs">
                <colgroup>
                  <col style={{ width: 88 }} />
                  <col style={{ width: 170 }} />
                  <col />
                </colgroup>
                <thead className="sticky top-0 z-10 bg-gray-100 text-[11px] uppercase tracking-wide text-gray-600">
                  <tr className="border-b border-gray-200">
                    <th className="px-3 py-2 text-left font-semibold">Time</th>
                    <th className="px-3 py-2 text-left font-semibold">Users (IP)</th>
                    <th className="px-3 py-2 text-left font-semibold">Messages</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    // MikroTik émet chaque évènement plusieurs fois pour la même session :
                    //   ligne 1: "trying to log in by mac-cookie"  (IP négociée)
                    //   ligne 2: "logged in"                       (IP finale, parfois différente)
                    //   + chaque ligne dupliquée avec préfixe "->:".
                    // On dédoublonne par (heure + user) — l'IP peut varier entre les deux
                    // lignes — et on garde l'action la plus informative.
                    const score = (a: string) => {
                      if (/^log in by /i.test(a)) return 3;
                      if (/^logged out .+/i.test(a)) return 3;
                      if (/^login failed /i.test(a)) return 3;
                      if (/^log in$/i.test(a)) return 1;
                      return 2;
                    };
                    const groups = new Map<string, LogEntry>();
                    for (const e of logs) {
                      const p = parseHotspotMessage(e.message);
                      const key = `${e.time}|${p.user ?? ""}`;
                      const prev = groups.get(key);
                      if (!prev) { groups.set(key, e); continue; }
                      const prevAction = parseHotspotMessage(prev.message).action;
                      if (score(p.action) > score(prevAction)) groups.set(key, e);
                    }
                    // Conserver l'ordre d'apparition d'origine
                    const seen = new Set<string>();
                    const dedup: LogEntry[] = [];
                    for (const e of logs) {
                      const p = parseHotspotMessage(e.message);
                      const key = `${e.time}|${p.user ?? ""}`;
                      if (seen.has(key)) continue;
                      seen.add(key);
                      const winner = groups.get(key);
                      if (winner) dedup.push(winner);
                    }
                    return dedup.map((entry, i) => {
                      const { icon, rowClass, timeClass } = classifyLog(entry);
                      const isNew = entry.id ? newIds.has(entry.id) : false;
                      const { user, ip, action } = parseHotspotMessage(entry.message);
                      const { first: timeLine1, second: timeLine2 } = splitLogTimeForDisplay(entry.time);
                      return (
                        <tr
                          key={entry.id || i}
                          className={`border-b border-gray-100 transition-colors duration-500 ${rowClass} ${isNew ? "bg-blue-50/60" : ""}`}
                          title={`[${entry.topics}]  ${entry.message}`}
                        >
                          <td
                            className={`px-3 py-2 align-top font-mono leading-tight break-words overflow-hidden ${timeClass}`}
                            title={entry.time}
                          >
                            {timeLine2 != null ? (
                              <>
                                <div>{timeLine1}</div>
                                <div>{timeLine2}</div>
                              </>
                            ) : (
                              entry.time
                            )}
                          </td>
                          <td className="px-3 py-2 align-top">
                            {user ? (
                              <div className="leading-tight">
                                <div className="font-mono text-gray-800 truncate">{user}</div>
                                {ip && <div className="font-mono text-[11px] text-gray-500 truncate">({ip})</div>}
                              </div>
                            ) : (
                              <span className="text-gray-400 italic">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 align-top">
                            <div className="flex items-start gap-2">
                              <span className="mt-0.5 shrink-0">{icon}</span>
                              <span className="text-gray-700 break-words leading-snug">{action}</span>
                            </div>
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
        </div>
      </div>

      </div>

      {/* ── Page d'erreur MikroTik hors ligne ─────────────────────────────── */}
      {showOfflineOverlay && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white rounded-xl py-16 px-4 min-h-[420px]">
          {/* Animation visuelle */}
          <div className="relative flex flex-col items-center mb-8">
            {/* Anneaux de pulsation */}
            <div className="relative flex items-center justify-center mb-4">
              <div className="absolute h-28 w-28 rounded-full bg-red-100 opacity-30" style={{ animation: "ping 2s cubic-bezier(0,0,.2,1) infinite" }} />
              <div className="absolute h-20 w-20 rounded-full bg-red-100 opacity-50 animate-pulse" />
              <div className="relative h-16 w-16 rounded-full bg-red-50 border-2 border-red-200 shadow-sm flex items-center justify-center">
                <WifiOff className="h-8 w-8 text-red-400" />
              </div>
            </div>

            {/* Points animés = signal cassé */}
            <div className="flex flex-col items-center gap-1.5 my-1">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-1.5 w-1.5 rounded-full bg-red-300 animate-bounce"
                  style={{ animationDelay: `${i * 0.18}s`, animationDuration: "1.1s" }}
                />
              ))}
            </div>

            {/* Icône routeur éteint */}
            <div className="mt-1 h-12 w-12 rounded-full bg-gray-100 border-2 border-gray-200 flex items-center justify-center">
              <Router className="h-6 w-6 text-gray-300" />
            </div>
          </div>

          {/* Message */}
          <h2 className="text-xl font-bold text-gray-800 text-center leading-snug">
            Impossible de contacter le routeur
          </h2>
          <p className="text-base font-bold text-red-500 text-center mt-1">
            MikroTik éteint ou hors ligne&nbsp;!!!
          </p>
          {isPingFailed ? (
            <>
              <p className="text-sm text-gray-500 text-center mt-3 max-w-sm leading-relaxed">
                Le routeur sélectionné ne répond pas après 3 tentatives de connexion.
              </p>
              <p className="text-sm text-gray-600 text-center mt-4 font-medium">
                Redirection vers la liste des routeurs dans{" "}
                <span className="tabular-nums text-red-600">{pingRedirectSecondsLeft}</span> s…
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-6 border-gray-200 text-gray-700 hover:bg-gray-50 gap-2"
                onClick={goToRoutersFromPingFail}
              >
                Aller aux routeurs maintenant
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-400 text-center mt-3 max-w-xs leading-relaxed">
                La connexion avec le routeur MikroTik est momentanément indisponible.<br />
                Reconnexion automatique en cours…
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-6 border-red-200 text-red-600 hover:bg-red-50 gap-2"
                onClick={() => { refetchPriority(); refetch(); refetchLogs(); }}
              >
                <RefreshCw className="h-4 w-4" />
                Réessayer maintenant
              </Button>
              <p className="text-[11px] text-gray-400 mt-4 flex items-center gap-1.5">
                <RefreshCw className="h-3 w-3 animate-spin" style={{ animationDuration: "3s" }} />
                Reconnexion automatique toutes les 15 secondes
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({
  title,
  value,
  label,
  amountValue,
  currency,
  sub,
  icon,
  iconBg,
  loading,
  live,
  fetching,
  href,
  className,
}: {
  title: string;
  value?: number;
  label?: string;
  amountValue?: number;
  currency?: string;
  sub?: string;
  icon: React.ReactNode;
  iconBg?: string;
  loading: boolean;
  live?: boolean;
  fetching?: boolean;
  href?: string;
  className?: string;
}) {
  const inner = (
    <Card
      aria-busy={loading}
      className={`relative h-[4.75rem] sm:h-full flex flex-col overflow-hidden ${href ? "cursor-pointer hover:shadow-md transition-shadow" : ""}`}
    >
      {loading ? (
        <div className="absolute inset-0 skeleton rounded-xl" aria-hidden />
      ) : (
      <div className="flex-1 flex p-2.5 sm:p-6 lg:px-4 lg:py-2.5 gap-2 sm:gap-3 lg:gap-2.5">
        {/* Icône — alignée avec le titre */}
        <div className={`p-1.5 rounded-xl flex-shrink-0 self-center ${iconBg ?? "bg-gray-100"}`}>{icon}</div>
        {/* Colonne texte : titre en haut, montant centré, sous-titre en bas */}
        <div className="min-w-0 flex-1 flex flex-col">
          {/* Titre */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <p className="text-xs text-gray-500 font-medium truncate">{title}</p>
            {live && (
              <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
              </span>
            )}
            {fetching && <RefreshCw className="h-2.5 w-2.5 text-gray-300 animate-spin flex-shrink-0" />}
          </div>
          {/* Montant / valeur — centré verticalement */}
          <div className="flex-1 flex items-center min-h-0">
            {label !== undefined ? (
              amountValue !== undefined ? (
                <p
                  className="amount-fill font-bold text-gray-900 leading-tight tracking-tight"
                  style={amountTextStyle(amountValue, currency || "FCFA")}
                >
                  {amountValue.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} {currency || "FCFA"}
                </p>
              ) : (
                <p className="fit-price font-bold text-gray-900 leading-tight truncate">{label || "—"}</p>
              )
            ) : value === undefined ? (
              live ? (
                <div className="skeleton h-6 w-24 rounded-md" />
              ) : (
                <p
                  className="amount-fill font-bold text-gray-900 leading-none"
                  style={{ "--awv": "4.83vw", lineHeight: 1.15, minWidth: 0 } as React.CSSProperties}
                >
                  —
                </p>
              )
            ) : (
              <p className="amount-fill font-bold text-gray-900 leading-none" style={{ "--awv": "4.83vw", lineHeight: 1.15, minWidth: 0 } as React.CSSProperties}>{value.toLocaleString()}</p>
            )}
          </div>
          {/* Sous-titre — collé en bas */}
          <div className="flex-shrink-0 min-h-[0.875rem]">
            {sub && <p className="text-xs text-gray-400 truncate">{sub}</p>}
          </div>
        </div>
      </div>
      )}
    </Card>
  );
  if (href) return <Link href={href} className={`block${className ? ` ${className}` : ""}`}>{inner}</Link>;
  return className ? <div className={className}>{inner}</div> : inner;
}
