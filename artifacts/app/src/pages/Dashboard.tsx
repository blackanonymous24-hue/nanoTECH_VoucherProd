import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import { Link } from "wouter";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useQuery } from "@tanstack/react-query";
import { useGetDashboard, useListRouterLogs, getGetDashboardQueryKey, getListRouterLogsQueryKey } from "@workspace/api-client-react";
import { useRouterContext } from "@/contexts/RouterContext";
import { useAuth } from "@/contexts/AuthContext";
import { usePageVisibility } from "@/hooks/use-page-visibility";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Ticket, TrendingUp, CalendarDays, Router, RefreshCw, Wifi, LogIn, LogOut, AlertCircle, Shield, Info, Cpu, HardDrive, Clock, Activity, WifiOff, UserPlus, Zap } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// Dashboard-level (router-agnostic) cache — stores last successful dashboard API response.
// Used as fallback display value while data refetches in background.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _dashboardCache: { data?: any; ts?: number } = {};

type LogEntry = { id: string; time: string; topics: string; message: string };

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
  totalMemory: string | null;
  freeMemory: string | null;
  uptime: string | null;
  architecture: string | null;
}

interface SalesLite {
  dailyCount: number;
  dailyAmount: number;
  monthlyCount: number;
  monthlyAmount: number;
  _cachedAt: number | null;
}

interface PrioritySnapshot {
  serverTs: number;
  sessionsCount: number;
  users: { total: number; available: number; used: number; disabled: number; cachedAt: number | null };
  sales: SalesLite;
  info: RouterInfo | null;
  availability?: {
    sessionsKnown?: boolean;
    usersKnown?: boolean;
    salesKnown?: boolean;
    infoKnown?: boolean;
  };
}

const PRIORITY_CACHE_KEY = "dashboard-priority-cache:v1";

function readPriorityCache(routerId: number | null): PrioritySnapshot | null {
  if (!routerId) return null;
  try {
    const raw = localStorage.getItem(`${PRIORITY_CACHE_KEY}:${routerId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PrioritySnapshot;
    if (!parsed || typeof parsed.serverTs !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePriorityCache(routerId: number | null, snapshot: PrioritySnapshot | null) {
  if (!routerId || !snapshot) return;
  try {
    localStorage.setItem(`${PRIORITY_CACHE_KEY}:${routerId}`, JSON.stringify(snapshot));
  } catch {
    // Ignore storage errors (private mode/quota)
  }
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

function formatAmount(amount: number): string {
  if (amount === 0) return "";
  return amount.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " FCFA";
}

function amountTextStyle(amount: number, currency = "FCFA"): React.CSSProperties {
  const amountStr = amount.toLocaleString("fr-FR", { maximumFractionDigits: 0 });
  const len = `${amountStr} ${currency}`.length;
  // Shrink aggressively from 24px down to 8px to always show full text.
  const size = Math.max(8, 24 - (len - 8) * 1.15);
  return { fontSize: `${size}px`, lineHeight: 1.15 };
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

function TrafficMonitorCard({ routerId, enabled = true }: { routerId: number | null; enabled?: boolean }) {
  const isVisible = usePageVisibility();
  const [history, setHistory] = useState<{ t: number; rx: number; tx: number }[]>([]);
  const [selectedIface, setSelectedIface] = useState<string>("");

  // Fetch interface list when router changes — gated on tab visibility
  const { data: ifaceList } = useQuery<{ name: string; type: string; disabled: boolean }[]>({
    queryKey: ["interfaces", routerId],
    queryFn: async ({ signal }) => {
      const res = await fetch(`${BASE}/api/routers/${routerId}/interfaces`, { signal });
      if (!res.ok) throw new Error("interfaces unavailable");
      return res.json();
    },
    enabled: isVisible && !!routerId && enabled,
    staleTime: 60_000,
    retry: false,
    throwOnError: false,
  });

  // Auto-select first non-disabled interface when list arrives
  useEffect(() => {
    if (!ifaceList?.length) return;
    setSelectedIface(prev => {
      if (prev && ifaceList.some(i => i.name === prev)) return prev;
      return ifaceList.find(i => !i.disabled)?.name ?? ifaceList[0].name ?? "";
    });
  }, [ifaceList]);

  const trafficUrl = routerId
    ? `${BASE}/api/routers/${routerId}/traffic?live=1${selectedIface ? `&iface=${encodeURIComponent(selectedIface)}` : ""}`
    : "";

  const { data, isError } = useQuery<{ rxBps: number; txBps: number; name: string | null }>({
    queryKey: ["traffic", routerId, selectedIface],
    queryFn: async ({ signal }) => {
      const res = await fetch(trafficUrl, { signal });
      if (!res.ok) throw new Error("traffic unavailable");
      return res.json();
    },
    // Gated sur la visibilité : pause quand onglet caché / navigateur minimisé.
    enabled: isVisible && !!routerId && enabled,
    refetchInterval: isVisible ? 3_000 : false,
    refetchIntervalInBackground: false,
    staleTime: 1_500,
    retry: false,
    throwOnError: false,
  });

  useEffect(() => {
    if (!data) return;
    setHistory(prev => [...prev, { t: Date.now(), rx: data.rxBps, tx: data.txBps }].slice(-MAX_TRAFFIC_POINTS));
  }, [data]);

  useEffect(() => {
    setHistory([]);
  }, [routerId, selectedIface]);

  const maxVal = Math.max(...history.flatMap(p => [p.rx, p.tx]), 1);
  const yTop = maxVal * 1.5;

  const yTicks = [0, yTop * 0.333, yTop * 0.667, yTop];

  return (
    <Card className="flex flex-col flex-1 min-w-0 min-h-[300px]">
      <CardHeader className="pb-2 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-gray-400" />
            Trafic
            {routerId && !isError && selectedIface && (
              <span className="flex items-center gap-1 text-xs font-normal text-green-600">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                </span>
                Live
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

      <CardContent className="flex flex-col flex-1 pt-3 pb-2 px-3" style={{ minHeight: 0 }}>
        {!routerId ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2">
            <Activity className="h-8 w-8 text-gray-200" />
            <p className="text-xs text-gray-400">Sélectionnez un routeur</p>
          </div>
        ) : isError ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2">
            <Activity className="h-8 w-8 text-red-200" />
            <p className="text-xs text-red-400">Indisponible</p>
          </div>
        ) : history.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2">
            <RefreshCw className="h-8 w-8 text-gray-300 animate-spin" />
            <p className="text-xs text-gray-400">Connexion au routeur…</p>
          </div>
        ) : (
          <div className="flex flex-col flex-1" style={{ minHeight: 0 }}>
            {selectedIface && (
              <p className="text-center text-xs font-medium text-gray-400 mb-1 font-mono">Interface {selectedIface}</p>
            )}
            {/* position:relative wrapper is the recharts trick to fill flex space with height="100%" */}
            <div className="flex-1" style={{ position: "relative", minHeight: 220 }}>
              <ResponsiveContainer width="100%" height="100%" minHeight={220}>
                <LineChart data={history} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
        )}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const isVisible = usePageVisibility();

  const { data: _freshData, isLoading, isFetching: dashFetching, isError, refetch } = useGetDashboard({
    query: {
      queryKey: getGetDashboardQueryKey(),
      // DB-only, pas de MikroTik — on garde le polling mais on le stoppe si onglet caché.
      refetchInterval: isVisible ? 10_000 : false,
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
  const data: any = _freshData ?? _dashboardCache.data;
  const { selectedRouterId, pingTrigger, setRouterOnline, setRouterIdentity } = useRouterContext();
  const { token: authToken } = useAuth();
  const [enableSecondaries, setEnableSecondaries] = useState(false);
  const [ssePriority, setSsePriority] = useState<PrioritySnapshot | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const prevIdsRef = useRef<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);

  // ── MikroTik offline detection ─────────────────────────────────────────────
  const [showErrorPage, setShowErrorPage] = useState(false);
  const mikFailCountRef = useRef(0);
  const mikLastFailTsRef = useRef(0);
  const mikLastSuccessTsRef = useRef(0);
  // ─────────────────────────────────────────────────────────────────────────────

  // Priority snapshot — architecture SSE-first :
  // Le vrai temps-réel vient du SSE (mikrotik-poller côté serveur, 1 appel MikroTik/5s partagé).
  // Ce useQuery ne sert qu'au chargement initial et comme filet de secours si le SSE est coupé.
  // refetchInterval allongé à 60s (au lieu de 15s) pour ne pas doubler les appels MikroTik.
  const {
    data: priority,
    isFetching: priorityQueryFetching,
    isLoading: priorityLoading,
    isError: priorityIsError,
    errorUpdatedAt: priorityErrorUpdatedAt,
    refetch: refetchPriority,
    dataUpdatedAt: priorityUpdatedAt,
  } = useQuery<PrioritySnapshot>({
    queryKey: ["router-dashboard-priority", selectedRouterId],
    queryFn: async ({ signal }) => {
      const res = await fetch(`${BASE}/api/routers/${selectedRouterId}/dashboard-priority`, { signal });
      if (!res.ok) throw new Error("dashboard priority unavailable");
      return res.json() as Promise<PrioritySnapshot>;
    },
    // Gated sur visibilité + token : aucune requête MikroTik si onglet caché ou déconnecté.
    enabled: isVisible && !!selectedRouterId,
    // Fallback poll — désactivé si SSE actif OU onglet caché (le SSE suffit quand visible).
    refetchInterval: (sseConnected || !isVisible) ? false : 20_000,
    refetchIntervalInBackground: false,
    staleTime: 10_000,
    retry: false,
    throwOnError: false,
    initialData: readPriorityCache(selectedRouterId) ?? undefined,
    initialDataUpdatedAt: readPriorityCache(selectedRouterId)?.serverTs ?? undefined,
  });

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

  const handleMikrotikRecovery = useCallback(() => {
    const now = Date.now();
    if (now - mikLastSuccessTsRef.current < 3_000) return; // debounce recovery
    mikLastSuccessTsRef.current = now;
    if (mikFailCountRef.current > 0) {
      mikFailCountRef.current = 0;
      mikLastFailTsRef.current = 0;
      setShowErrorPage(false);
      toast.dismiss("mikrotik-status");
    }
  }, []);

  useEffect(() => {
    // Fermer le SSE si : pas de routeur sélectionné, utilisateur déconnecté, ou onglet caché.
    // Quand isVisible repasse à true, l'effet se réexécute et rouvre la connexion.
    if (!selectedRouterId || !authToken || !isVisible) {
      setSseConnected(false);
      // On garde ssePriority en cache pour que les cartes restent affichées en caché.
      return;
    }
    const tokenParam = `?token=${encodeURIComponent(authToken)}`;
    const es = new EventSource(`${BASE}/api/routers/${selectedRouterId}/dashboard-priority/stream${tokenParam}`);
    es.onopen = () => setSseConnected(true);
    const onPriority = (ev: MessageEvent) => {
      try {
        const payload = JSON.parse(ev.data) as PrioritySnapshot;
        setSsePriority(payload);
        writePriorityCache(selectedRouterId, payload);
        setRouterOnline(true);
        handleMikrotikRecovery();
      } catch {
        // fallback polling still active
      }
    };
    const onSseError = (_ev: MessageEvent) => {
      // Server-sent "event: error" = MikroTik unreachable
      handleMikrotikFailure();
    };
    es.addEventListener("priority", onPriority as EventListener);
    es.addEventListener("error", onSseError as EventListener);
    es.onerror = () => setSseConnected(false);
    return () => {
      es.removeEventListener("priority", onPriority as EventListener);
      es.removeEventListener("error", onSseError as EventListener);
      es.close();
      setSseConnected(false);
    };
  }, [selectedRouterId, authToken, isVisible, setRouterOnline, handleMikrotikFailure, handleMikrotikRecovery]);

  const livePriority = ssePriority ?? priority;
  useEffect(() => {
    if (!selectedRouterId || !livePriority) return;
    writePriorityCache(selectedRouterId, livePriority);
  }, [selectedRouterId, livePriority]);
  const activeSessions = livePriority?.sessionsCount;
  const usersStats = livePriority?.users;
  const hotspotUserCount = usersStats?.available ?? usersStats?.total;
  const sales = livePriority?.sales;
  const salesFresh = !!sales && sales._cachedAt != null;
  const routerInfo = livePriority?.info ?? null;
  const infoLoading = !!selectedRouterId && !livePriority && priorityLoading;
  const sessionsFetching = !sseConnected && priorityQueryFetching;
  const usersFetching = !sseConnected && priorityQueryFetching;
  const salesFetching = !sseConnected && priorityQueryFetching;
  // Stale-while-revalidate : dès qu'on a un snapshot (cache localStorage ou SSE/polling),
  // on affiche la valeur immédiatement — jamais de skeleton si une donnée est disponible.
  // Le skeleton n'apparaît QUE si aucune donnée n'existe encore (première visite sur ce routeur).
  const sessionsKnown = !!livePriority;
  const usersKnown    = !!livePriority;
  const infoKnown     = !!livePriority;

  // Mikhmon-style: fire every dashboard fetch in parallel immediately, no
  // gating. Priority cards (info / sessions / sales / tickets) are served
  // stale-while-revalidate by the API so they paint instantly from the last
  // known value, exactly like Mikhmon v3.
  const priorityReady = !!selectedRouterId
    && sessionsKnown
    && usersKnown
    && salesFresh
    && infoKnown;

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
        enabled: isVisible && !!selectedRouterId && enableSecondaries,
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

  useEffect(() => {
    if (!selectedRouterId || !ssePriority) return;
    lastSuccessRef.current = Math.max(lastSuccessRef.current, ssePriority.serverTs || Date.now());
    setRouterOnline(true);
  }, [ssePriority, selectedRouterId, setRouterOnline]);

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
    refetch();
    if (selectedRouterId) {
      refetchLogs();
      refetchPriority();
    }
  };

  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-3">
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

      {/* Router hardware/software info bar */}
      {selectedRouterId && (
        <div className="mb-6">
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
                  <span className="truncate min-w-0">{routerInfo.cpu}{routerInfo.cpuCount && routerInfo.cpuCount !== "1" ? ` ×${routerInfo.cpuCount}` : ""}</span>
                </span>
              )}
              {(routerInfo.freeMemory || routerInfo.totalMemory) && (
                <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-green-50 border border-green-100 text-[10px] sm:text-xs font-medium text-green-700 overflow-hidden">
                  <HardDrive className="h-2.5 w-2.5 sm:h-3 sm:w-3 flex-shrink-0" />
                  <span className="truncate min-w-0">{formatMemory(routerInfo.freeMemory)}/{formatMemory(routerInfo.totalMemory)}</span>
                </span>
              )}
              {routerInfo.uptime && (
                <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 border border-gray-200 text-[10px] sm:text-xs font-medium text-gray-600 overflow-hidden">
                  <Clock className="h-2.5 w-2.5 sm:h-3 sm:w-3 flex-shrink-0" />
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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-1 sm:gap-4 mb-3 [grid-auto-rows:4.75rem] sm:[grid-auto-rows:auto]">
        <StatCard
          title="Clients actifs"
          value={selectedRouterId ? activeSessions : 0}
          live={!!selectedRouterId}
          fetching={sessionsFetching}
          icon={<Wifi className="h-5 w-5 text-purple-500" />}
          loading={!!selectedRouterId && !sessionsKnown}
          href="/sessions"
        />
        <StatCard
          title="Vendu aujourd'hui"
          label={salesFresh ? formatAmount(sales!.dailyAmount) : undefined}
          amountValue={salesFresh ? sales!.dailyAmount : undefined}
          currency="FCFA"
          sub={salesFresh ? `${sales!.dailyCount.toLocaleString()} tickets vendus` : undefined}
          live={!!selectedRouterId}
          fetching={salesFetching}
          icon={<CalendarDays className="h-5 w-5 text-orange-500" />}
          loading={!!selectedRouterId && !salesFresh}
          href="/sales/daily"
        />
        <StatCard
          title="Vente mensuelle"
          label={salesFresh ? formatAmount(sales!.monthlyAmount) : undefined}
          amountValue={salesFresh ? sales!.monthlyAmount : undefined}
          currency="FCFA"
          sub={salesFresh ? `${sales!.monthlyCount.toLocaleString()} tickets vendus` : undefined}
          live={!!selectedRouterId}
          fetching={salesFetching}
          icon={<TrendingUp className="h-5 w-5 text-green-500" />}
          loading={!!selectedRouterId && !salesFresh}
          href="/sales/monthly"
        />
        <StatCard
          title="Tickets disponibles"
          value={selectedRouterId ? hotspotUserCount : (data?.totalVouchers ?? 0)}
          live={!!selectedRouterId}
          fetching={usersFetching}
          icon={<Ticket className="h-5 w-5 text-blue-500" />}
          loading={!!selectedRouterId && !usersKnown}
          href="/vouchers"
        />
        {/* Raccourcis actions — mobile uniquement */}
        <div className="col-span-2 lg:hidden" style={{display:"flex", flexDirection:"row", gap:"4px", alignItems:"stretch"}}>
          <button
            type="button"
            style={{flex:1, minWidth:0, textAlign:"left"}}
            onClick={() => window.dispatchEvent(new CustomEvent("open-add-client-dialog"))}
          >
            <Card className="min-h-[52px] h-full flex flex-col cursor-pointer hover:shadow-md transition-shadow active:scale-95">
              <div className="flex-1 flex items-center gap-2 p-2.5">
                <div className="p-1.5 bg-emerald-100 rounded-xl flex-shrink-0">
                  <UserPlus className="h-5 w-5 text-emerald-600" />
                </div>
                <p className="text-[13px] font-bold text-gray-700 whitespace-nowrap leading-none">Ajouter un client</p>
              </div>
            </Card>
          </button>
          <Link href="/generate" style={{flex:1, minWidth:0, display:"block"}}>
            <Card className="min-h-[52px] h-full flex flex-col cursor-pointer hover:shadow-md transition-shadow active:scale-95">
              <div className="flex-1 flex items-center gap-2 p-2.5">
                <div className="p-1.5 bg-amber-100 rounded-xl flex-shrink-0">
                  <Zap className="h-5 w-5 text-amber-500" />
                </div>
                <p className="text-[13px] font-bold text-gray-700 whitespace-nowrap leading-none">Générer un ticket</p>
              </div>
            </Card>
          </Link>
        </div>
      </div>

      {/* Raccourcis actions — desktop uniquement, ligne séparée pleine largeur */}
      <div className="hidden lg:flex gap-4 mb-3">
        <button
          type="button"
          className="flex-1"
          onClick={() => window.dispatchEvent(new CustomEvent("open-add-client-dialog"))}
        >
          <Card className="h-full flex flex-col cursor-pointer hover:shadow-md transition-shadow">
            <div className="flex items-center gap-3 px-5 py-3">
              <div className="p-2 bg-emerald-100 rounded-xl flex-shrink-0">
                <UserPlus className="h-5 w-5 text-emerald-600" />
              </div>
              <p className="text-sm font-bold text-gray-700">Ajouter un client</p>
            </div>
          </Card>
        </button>
        <Link href="/generate" className="flex-1">
          <Card className="h-full flex flex-col cursor-pointer hover:shadow-md transition-shadow">
            <div className="flex items-center gap-3 px-5 py-3">
              <div className="p-2 bg-amber-100 rounded-xl flex-shrink-0">
                <Zap className="h-5 w-5 text-amber-500" />
              </div>
              <p className="text-sm font-bold text-gray-700">Générer un ticket</p>
            </div>
          </Card>
        </Link>
      </div>

      <div className="traffic-logs-layout flex flex-col gap-4 items-stretch">
      <TrafficMonitorCard routerId={selectedRouterId} enabled={enableSecondaries} />
      <Card className="flex-1 min-w-0">
        <CardHeader className="pb-2 border-b border-gray-100">
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
                      return (
                        <tr
                          key={entry.id || i}
                          className={`border-b border-gray-100 transition-colors duration-500 ${rowClass} ${isNew ? "bg-blue-50/60" : ""}`}
                          title={`[${entry.topics}]  ${entry.message}`}
                        >
                          <td className={`px-3 py-2 align-top whitespace-nowrap font-mono ${timeClass}`}>
                            {entry.time}
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

      {/* ── Page d'erreur MikroTik hors ligne ─────────────────────────────── */}
      {showErrorPage && selectedRouterId && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white/98 backdrop-blur-sm rounded-xl py-16 px-4 min-h-[420px]">
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
            Impossible de récupérer les infos du routeur
          </h2>
          <p className="text-base font-bold text-red-500 text-center mt-1">
            MikroTik éteint ou hors ligne&nbsp;!!!
          </p>
          <p className="text-sm text-gray-400 text-center mt-3 max-w-xs leading-relaxed">
            La connexion avec le routeur MikroTik est momentanément indisponible.<br />
            Reconnexion automatique en cours…
          </p>

          {/* Bouton de réessai */}
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
  loading: boolean;
  live?: boolean;
  fetching?: boolean;
  href?: string;
  className?: string;
}) {
  const inner = (
    <Card className={`h-full flex flex-col ${href ? "cursor-pointer hover:shadow-md transition-shadow" : ""}`}>
      <div className="flex-1 flex flex-col justify-center p-2.5 sm:p-6">
        {/* Icône visible seulement sm+ */}
        <div className="hidden sm:flex items-center gap-3">
          <div className="p-2.5 bg-gray-100 rounded-lg flex-shrink-0">{icon}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="text-xs text-gray-500 font-medium truncate">{title}</p>
              {live && (
                <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
                </span>
              )}
              {fetching && <RefreshCw className="h-2.5 w-2.5 text-gray-300 animate-spin flex-shrink-0" />}
            </div>
            <div className="min-h-[2.75rem] flex flex-col justify-center">
              {loading ? (
                <>
                  <div className="h-7 w-24 bg-gray-200 rounded animate-pulse mt-1" />
                  <div className="h-3 w-16 bg-gray-100 rounded animate-pulse mt-1.5" />
                </>
              ) : label !== undefined ? (
                <>
                  {amountValue !== undefined ? (
                    <p
                      className="font-bold text-gray-900 whitespace-nowrap leading-tight tracking-tight"
                      style={amountTextStyle(amountValue, currency || "FCFA")}
                    >
                      {amountValue.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} {currency || "FCFA"}
                    </p>
                  ) : (
                    <p className="fit-price font-bold text-gray-900 leading-tight truncate">{label || "0 FCFA"}</p>
                  )}
                  {sub && <p className="text-xs text-gray-400 mt-0.5 truncate">{sub}</p>}
                </>
              ) : (
                <>
                  <p className="fit-price font-bold text-gray-900 truncate">{value === undefined ? "—" : value.toLocaleString()}</p>
                  {sub && <p className="text-xs text-gray-400 -mt-0.5 truncate">{sub}</p>}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Version mobile ultra-compacte (< sm) */}
        <div className="flex sm:hidden flex-col gap-0.5 justify-center">
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-gray-500 font-medium leading-tight truncate">{title}</span>
            {live && (
              <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
              </span>
            )}
            {fetching && <RefreshCw className="h-2 w-2 text-gray-300 animate-spin flex-shrink-0" />}
          </div>
          {loading ? (
            <div className="h-5 w-16 bg-gray-200 rounded animate-pulse mt-0.5" />
          ) : label !== undefined ? (
            <>
              <p className="font-bold text-gray-900 text-lg leading-tight mt-0.5 truncate tabular-nums">
                {amountValue !== undefined
                  ? amountValue.toLocaleString("fr-FR", { maximumFractionDigits: 0 })
                  : (label || "0")}
                <span className="text-[9px] font-bold text-gray-400 ml-0.5">{currency || "FCFA"}</span>
              </p>
              {sub && <p className="text-[9px] text-gray-400 leading-tight truncate">{sub}</p>}
            </>
          ) : (
            <p className="font-bold text-gray-900 text-2xl leading-none mt-0.5 truncate">
              {value === undefined ? "—" : value.toLocaleString()}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
  if (href) return <Link href={href} className={`block${className ? ` ${className}` : ""}`}>{inner}</Link>;
  return className ? <div className={className}>{inner}</div> : inner;
}
