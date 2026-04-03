import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useQuery } from "@tanstack/react-query";
import { useGetDashboard, useListRouterLogs, useGetRouterSales } from "@workspace/api-client-react";
import { useRouterContext } from "@/contexts/RouterContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Ticket, TrendingUp, CalendarDays, Router, RefreshCw, Wifi, LogIn, LogOut, AlertCircle, Shield, Info, Cpu, HardDrive, Clock, Activity } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type LogEntry = { id: string; time: string; topics: string; message: string };

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

function formatUptime(raw: string | null): string | null {
  if (!raw) return null;
  return raw
    .replace(/(\d+)w/, "$1sem ")
    .replace(/(\d+)d/, "$1j ")
    .replace(/(\d+)h/, "$1h ")
    .replace(/(\d+)m/, "$1min ")
    .replace(/(\d+)s/, "")
    .trim();
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

function TrafficMonitorCard({ routerId }: { routerId: number | null }) {
  const [history, setHistory] = useState<{ t: number; rx: number; tx: number }[]>([]);
  const [selectedIface, setSelectedIface] = useState<string>("");

  // Fetch interface list when router changes
  const { data: ifaceList } = useQuery<{ name: string; type: string; disabled: boolean }[]>({
    queryKey: ["interfaces", routerId],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/routers/${routerId}/interfaces`);
      if (!res.ok) throw new Error("interfaces unavailable");
      return res.json();
    },
    enabled: !!routerId,
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
    ? `${BASE}/api/routers/${routerId}/traffic${selectedIface ? `?iface=${encodeURIComponent(selectedIface)}` : ""}`
    : "";

  const { data, isError } = useQuery<{ rxBps: number; txBps: number; name: string | null }>({
    queryKey: ["traffic", routerId, selectedIface],
    queryFn: async () => {
      const res = await fetch(trafficUrl);
      if (!res.ok) throw new Error("traffic unavailable");
      return res.json();
    },
    enabled: !!routerId && !!selectedIface,
    refetchInterval: 3_000,
    staleTime: 2_500,
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
    <Card className="flex flex-col flex-1 min-w-0">
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
          <div className="flex-1 flex items-center justify-center">
            <RefreshCw className="h-5 w-5 animate-spin text-gray-300" />
          </div>
        ) : (
          <div className="flex flex-col flex-1" style={{ minHeight: 0 }}>
            {selectedIface && (
              <p className="text-center text-xs font-medium text-gray-400 mb-1 font-mono">Interface {selectedIface}</p>
            )}
            {/* position:relative wrapper is the recharts trick to fill flex space with height="100%" */}
            <div className="flex-1" style={{ position: "relative", minHeight: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
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
  const { data, isLoading, isFetching: dashFetching, isError, refetch } = useGetDashboard({
    query: { refetchInterval: 10_000, staleTime: 9_000 },
  });
  const { selectedRouterId, pingTrigger, setRouterOnline, setRouterIdentity } = useRouterContext();
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const prevIdsRef = useRef<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);

  const {
    data: activeSessions,
    isFetching: sessionsFetching,
    dataUpdatedAt: sessionsUpdatedAt,
    refetch: refetchSessions,
  } = useQuery({
    queryKey: ["router-sessions", selectedRouterId],
    queryFn: async (): Promise<number> => {
      const res = await fetch(`${BASE}/api/routers/${selectedRouterId}/sessions`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: unknown = await res.json();
      return Array.isArray(data) ? data.length : 0;
    },
    enabled: !!selectedRouterId,
    refetchInterval: 10_000,
    staleTime: 9_000,
    throwOnError: false,
    retry: false,
  });

  const {
    data: hotspotUserCount,
    isFetching: usersFetching,
    refetch: refetchUsers,
  } = useQuery({
    queryKey: ["router-users-count", selectedRouterId],
    queryFn: async (): Promise<number> => {
      const res = await fetch(`${BASE}/api/routers/${selectedRouterId}/users`);
      if (!res.ok) return 0;
      const data: unknown = await res.json();
      if (Array.isArray(data)) return data.length;
      if (data && typeof data === "object") {
        const d = data as Record<string, unknown>;
        if (typeof d.total === "number") return d.total;
        if (Array.isArray(d.users)) return d.users.length;
      }
      return 0;
    },
    enabled: !!selectedRouterId,
    refetchInterval: 10_000,
    staleTime: 9_000,
    throwOnError: false,
  });

  const {
    data: sales,
    isFetching: salesFetching,
    refetch: refetchSales,
  } = useGetRouterSales(
    selectedRouterId ?? 0,
    {
      query: {
        enabled: !!selectedRouterId,
        refetchInterval: 10_000,
        staleTime: 9_000,
      },
    },
  );

  const {
    data: logs = [],
    isLoading: logsLoading,
    isFetching: logsFetching,
    refetch: refetchLogs,
    error: logsError,
  } = useListRouterLogs(
    selectedRouterId ?? 0,
    { limit: 80, topics: "hotspot" },
    {
      query: {
        enabled: !!selectedRouterId,
        refetchInterval: 5_000,
        staleTime: 4_000,
      },
    },
  );

  useEffect(() => {
    if (!logs.length) return;
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
    if (!selectedRouterId || sessionsUpdatedAt === 0) return;
    lastSuccessRef.current = Math.max(lastSuccessRef.current, sessionsUpdatedAt);
    setRouterOnline(true);
  }, [sessionsUpdatedAt, selectedRouterId, setRouterOnline]);

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

  const {
    data: routerInfo,
    isLoading: infoLoading,
    refetch: refetchInfo,
  } = useQuery<RouterInfo>({
    queryKey: ["router-info", selectedRouterId],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/routers/${selectedRouterId}/info`);
      if (!res.ok) throw new Error("info unavailable");
      return res.json() as Promise<RouterInfo>;
    },
    enabled: !!selectedRouterId,
    staleTime: 60_000,
    retry: false,
    throwOnError: false,
  });

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
    refetchSales();
    refetchSessions();
    refetchUsers();
    refetchInfo();
  }, [pingTrigger, refetch, refetchLogs, refetchSales, refetchSessions, refetchUsers, refetchInfo]);

  const handleRefresh = () => {
    refetch();
    if (selectedRouterId) {
      refetchLogs();
      refetchSales();
      refetchSessions();
      refetchUsers();
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tableau de bord</h1>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          className="gap-1.5 text-gray-500"
        >
          <RefreshCw className={`h-4 w-4 ${logsFetching ? "animate-spin" : ""}`} />
          Actualiser
        </Button>
      </div>

      {/* Router hardware/software info bar */}
      {selectedRouterId && (
        <div className="mb-6">
          {infoLoading ? (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <RefreshCw className="h-3 w-3 animate-spin" />
              Récupération des informations routeur…
            </div>
          ) : routerInfo ? (
            <div className="flex flex-wrap items-center gap-2">
              {(routerInfo.boardName || routerInfo.model) && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-blue-50 border border-blue-100 text-xs font-medium text-blue-700">
                  <Router className="h-3 w-3" />
                  {routerInfo.boardName ?? routerInfo.model}
                </span>
              )}
              {routerInfo.routerOsVersion && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-violet-50 border border-violet-100 text-xs font-medium text-violet-700">
                  <Shield className="h-3 w-3" />
                  RouterOS {routerInfo.routerOsVersion}
                </span>
              )}
              {routerInfo.cpu && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-100 text-xs font-medium text-amber-700">
                  <Cpu className="h-3 w-3" />
                  {routerInfo.cpu}{routerInfo.cpuCount && routerInfo.cpuCount !== "1" ? ` × ${routerInfo.cpuCount}` : ""}
                </span>
              )}
              {(routerInfo.freeMemory || routerInfo.totalMemory) && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-green-50 border border-green-100 text-xs font-medium text-green-700">
                  <HardDrive className="h-3 w-3" />
                  {formatMemory(routerInfo.freeMemory)} libre / {formatMemory(routerInfo.totalMemory)}
                </span>
              )}
              {routerInfo.uptime && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gray-100 border border-gray-200 text-xs font-medium text-gray-600">
                  <Clock className="h-3 w-3" />
                  En ligne {formatUptime(routerInfo.uptime)}
                </span>
              )}
              {(routerInfo.clockDate || routerInfo.clockTime) && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gray-50 border border-gray-200 text-xs text-gray-500 font-mono">
                  <Clock className="h-3 w-3" />
                  {[routerInfo.clockDate, routerInfo.clockTime].filter(Boolean).join(" ")}
                </span>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-500">Vue d&apos;ensemble de votre système</p>
          )}
        </div>
      )}

      {!selectedRouterId && (
        <p className="text-sm text-gray-500 mb-6">Vue d&apos;ensemble de votre système</p>
      )}

      {isError && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 text-sm">
          Impossible de charger les statistiques.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-3">
        <StatCard
          title="Clients actifs"
          value={selectedRouterId ? (activeSessions ?? 0) : 0}
          live={!!selectedRouterId}
          fetching={sessionsFetching}
          icon={<Wifi className="h-5 w-5 text-purple-500" />}
          loading={!!selectedRouterId && activeSessions === undefined}
          href="/sessions"
        />
        <StatCard
          title="Vente journalière"
          label={sales ? formatAmount(sales.dailyAmount) : undefined}
          sub={sales ? `${sales.dailyCount.toLocaleString()} tickets vendus` : undefined}
          live={!!selectedRouterId}
          fetching={salesFetching}
          icon={<CalendarDays className="h-5 w-5 text-orange-500" />}
          loading={!sales && !!selectedRouterId}
          href="/sales/daily"
        />
        <StatCard
          title="Vente mensuelle"
          label={sales ? formatAmount(sales.monthlyAmount) : undefined}
          sub={sales ? `${sales.monthlyCount.toLocaleString()} tickets vendus` : undefined}
          live={!!selectedRouterId}
          fetching={salesFetching}
          icon={<TrendingUp className="h-5 w-5 text-green-500" />}
          loading={!sales && !!selectedRouterId}
          href="/sales/monthly"
        />
        <StatCard
          title="Total Vouchers"
          value={selectedRouterId ? (hotspotUserCount ?? 0) : (data?.totalVouchers ?? 0)}
          live={!!selectedRouterId}
          fetching={usersFetching}
          icon={<Ticket className="h-5 w-5 text-blue-500" />}
          loading={!!selectedRouterId && hotspotUserCount === undefined}
          href="/vouchers"
        />
      </div>

      <div className="flex gap-4 items-stretch">
      <TrafficMonitorCard routerId={selectedRouterId} />
      <Card className="flex-1 min-w-0">
        <CardHeader className="pb-2 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              Logs Hotspot
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
            <span className="text-xs text-gray-400">↻ 5s</span>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {!selectedRouterId ? (
            <div className="py-14 text-center">
              <Wifi className="h-8 w-8 text-gray-200 mx-auto mb-2" />
              <p className="text-sm text-gray-400">Sélectionnez un routeur dans la barre de gauche</p>
            </div>
          ) : logsLoading ? (
            <div className="py-10 text-center text-sm text-gray-400">
              <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2 text-gray-300" />
              Connexion au routeur…
            </div>
          ) : logsError ? (
            <div className="py-10 text-center text-sm text-red-400">
              Impossible de récupérer les logs hotspot.
            </div>
          ) : logs.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400">
              Aucun log hotspot disponible.
            </div>
          ) : (
            <div
              ref={listRef}
              className="divide-y divide-gray-50 max-h-[210px] overflow-y-auto"
            >
              {logs.map((entry, i) => {
                const { icon, rowClass, timeClass } = classifyLog(entry);
                const isNew = entry.id ? newIds.has(entry.id) : false;
                return (
                  <div
                    key={entry.id || i}
                    className={`flex items-start gap-2.5 px-4 py-2 font-mono text-xs transition-colors duration-500 ${rowClass} ${isNew ? "bg-blue-50/60" : ""}`}
                  >
                    {icon}
                    <span className={`whitespace-nowrap flex-shrink-0 w-24 ${timeClass}`}>
                      {entry.time}
                    </span>
                    <span className="text-gray-700 break-all leading-5">{entry.message}</span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  label,
  sub,
  icon,
  loading,
  live,
  fetching,
  href,
}: {
  title: string;
  value?: number;
  label?: string;
  sub?: string;
  icon: React.ReactNode;
  loading: boolean;
  live?: boolean;
  fetching?: boolean;
  href?: string;
}) {
  const inner = (
    <Card className={href ? "cursor-pointer hover:shadow-md transition-shadow" : ""}>
      <CardContent className="pt-5">
        <div className="flex items-start gap-3">
          <div className="p-2.5 bg-gray-100 rounded-lg flex-shrink-0 mt-0.5">{icon}</div>
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
                  <p className="text-xl font-bold text-gray-900 leading-tight">{label || "0 FCFA"}</p>
                  {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
                </>
              ) : (
                <>
                  <p className="text-2xl font-bold text-gray-900">{(value ?? 0).toLocaleString()}</p>
                  {sub && <p className="text-xs text-gray-400 -mt-0.5">{sub}</p>}
                </>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
  if (href) return <Link href={href} className="block">{inner}</Link>;
  return inner;
}
