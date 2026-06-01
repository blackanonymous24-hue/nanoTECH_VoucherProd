import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, CircleDot, Loader2, MapPin, MonitorSmartphone, RefreshCw, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const POLL_MS = 15_000;

type UserType = "admin" | "vendor" | "manager" | "collaborateur";

interface LiveSession {
  sessionId: string;
  userType: UserType;
  userId: number;
  displayName: string;
  login: string | null;
  tenantLabel: string | null;
  deviceLabel: string | null;
  deviceShort: string;
  countryCode: string | null;
  countryName: string | null;
  city: string | null;
  locationLabel: string | null;
  createdAt: string;
  lastActiveAt: string;
  isOnline: boolean;
  persistent: boolean;
}

interface MonitoringPayload {
  generatedAt: string;
  onlineCount: number;
  sessionCount: number;
  live: LiveSession[];
  stats: { day: number; week: number; month: number; year: number };
  geoEnabled: boolean;
}

const ROLE_LABEL: Record<UserType, string> = {
  admin: "Admin",
  vendor: "Vendeur",
  manager: "Gérant",
  collaborateur: "Collaborateur",
};

const ROLE_BADGE: Record<UserType, string> = {
  admin: "bg-blue-100 text-blue-700",
  vendor: "bg-amber-100 text-amber-800",
  manager: "bg-emerald-100 text-emerald-700",
  collaborateur: "bg-purple-100 text-purple-700",
};

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtRelative(iso: string, nowMs: number): string {
  const diff = Math.max(0, nowMs - new Date(iso).getTime());
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "À l'instant";
  if (mins < 60) return `Il y a ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  return `Il y a ${days} j`;
}

function ConnectionRing({
  label,
  value,
  maxValue,
  colorClass,
}: {
  label: string;
  value: number;
  maxValue: number;
  colorClass: string;
}) {
  const size = 132;
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = maxValue > 0 ? Math.min(1, value / maxValue) : 0;
  const offset = circumference * (1 - ratio);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            className="text-gray-100"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className={colorClass}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold tabular-nums text-gray-900">{value}</span>
          <span className="text-[10px] uppercase tracking-wide text-gray-500">connexions</span>
        </div>
      </div>
      <p className="text-sm font-medium text-gray-700">{label}</p>
    </div>
  );
}

export default function SuperMonitoring() {
  const { token } = useAuth();
  const headers = useMemo(
    () => ({ Authorization: `Bearer ${token}` }),
    [token],
  );

  const { data, isLoading, isFetching, dataUpdatedAt, refetch } = useQuery<MonitoringPayload>({
    queryKey: ["super-monitoring"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/super/monitoring`, { headers });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Impossible de charger le monitoring");
      }
      return res.json();
    },
    refetchInterval: POLL_MS,
    enabled: !!token,
  });

  const nowMs = dataUpdatedAt || Date.now();
  const stats = data?.stats ?? { day: 0, week: 0, month: 0, year: 0 };
  const maxStat = Math.max(stats.day, stats.week, stats.month, stats.year, 1);

  const rings = [
    { label: "Aujourd'hui", value: stats.day, colorClass: "text-orange-500" },
    { label: "Cette semaine", value: stats.week, colorClass: "text-blue-500" },
    { label: "Ce mois", value: stats.month, colorClass: "text-emerald-500" },
    { label: "Cette année", value: stats.year, colorClass: "text-violet-500" },
  ];

  const live = data?.live ?? [];
  const onlineSessions = live.filter((s) => s.isOnline);
  const idleSessions = live.filter((s) => !s.isOnline);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Activity className="h-5 w-5 text-orange-500" />
            Monitoring connexions
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Utilisateurs connectés à l&apos;application — réservé au super-admin.
            {data?.geoEnabled === false && (
              <span className="block text-amber-600 mt-1">
                GeoLite2 non configuré : ville/pays visibles après installation de la base MaxMind.
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refetch()}
          className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors self-start"
        >
          {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Actualiser
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-emerald-100 flex items-center justify-center">
                <CircleDot className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold tabular-nums">{isLoading ? "—" : data?.onlineCount ?? 0}</p>
                <p className="text-xs text-gray-500">En ligne (&lt; 5 min)</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <Users className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold tabular-nums">{isLoading ? "—" : data?.sessionCount ?? 0}</p>
                <p className="text-xs text-gray-500">Sessions actives</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="col-span-2">
          <CardContent className="pt-4 pb-4">
            <p className="text-xs text-gray-500">
              Dernière mise à jour :{" "}
              {data?.generatedAt ? fmtDateTime(data.generatedAt) : "—"}
              {" · "}
              rafraîchissement auto toutes les 15 s
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Connexions par période</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 py-4">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-36 w-full rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 py-2 justify-items-center">
              {rings.map((ring) => (
                <ConnectionRing
                  key={ring.label}
                  label={ring.label}
                  value={ring.value}
                  maxValue={maxStat}
                  colorClass={ring.colorClass}
                />
              ))}
            </div>
          )}
          <p className="text-xs text-gray-500 text-center mt-2">
            Nombre de nouvelles connexions (sessions) ouvertes sur la période.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <MonitorSmartphone className="h-4 w-4 text-gray-500" />
            Utilisateurs en temps réel
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="divide-y divide-gray-50">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="px-4 py-3 flex gap-3">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <Skeleton className="h-4 flex-1" />
                </div>
              ))}
            </div>
          ) : live.length === 0 ? (
            <p className="px-4 py-8 text-sm text-gray-500 text-center">Aucune session active.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase tracking-wide">
                    <th className="px-4 py-2.5 font-medium">Utilisateur</th>
                    <th className="px-4 py-2.5 font-medium">Rôle</th>
                    <th className="px-4 py-2.5 font-medium hidden md:table-cell">Tenant</th>
                    <th className="px-4 py-2.5 font-medium hidden lg:table-cell">Localisation</th>
                    <th className="px-4 py-2.5 font-medium hidden sm:table-cell">Appareil</th>
                    <th className="px-4 py-2.5 font-medium">Statut</th>
                    <th className="px-4 py-2.5 font-medium hidden lg:table-cell">Connecté depuis</th>
                    <th className="px-4 py-2.5 font-medium">Activité</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {[...onlineSessions, ...idleSessions].map((session) => (
                    <tr key={session.sessionId} className="hover:bg-gray-50/80">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{session.displayName}</div>
                        {session.login && session.login !== session.displayName && (
                          <div className="text-xs text-gray-500">{session.login}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn("inline-block px-2 py-0.5 rounded-full text-xs font-medium", ROLE_BADGE[session.userType])}>
                          {ROLE_LABEL[session.userType]}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-gray-600">
                        {session.tenantLabel ?? "—"}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell text-gray-600">
                        {session.locationLabel ? (
                          <span className="inline-flex items-center gap-1 max-w-[180px] truncate" title={session.locationLabel}>
                            <MapPin className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                            {session.locationLabel}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell text-gray-600 max-w-[160px] truncate" title={session.deviceLabel ?? undefined}>
                        {session.deviceShort}
                      </td>
                      <td className="px-4 py-3">
                        {session.isOnline ? (
                          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                            En ligne
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-gray-200 text-gray-600">
                            Inactif
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell text-gray-600 tabular-nums">
                        {fmtDateTime(session.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-gray-600 tabular-nums">
                        {fmtRelative(session.lastActiveAt, nowMs)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
