import { useEffect, useMemo, useState } from "react";
import { useRouterContext } from "@/contexts/RouterContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RefreshCw, Search, Database, Router } from "lucide-react";
import { foldText } from "@/lib/text";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const LEASES_CACHE_KEY = "dhcp-leases-cache:v1";

interface DhcpLease {
  id: string;
  address: string;
  macAddress: string;
  activeAddress: string | null;
  activeMacAddress: string | null;
  hostName: string | null;
  status: string | null;
  expiresAfter: string | null;
  server: string | null;
  dynamic: boolean;
}

export default function DhcpLeases() {
  const { selectedRouterId } = useRouterContext();
  const [leases, setLeases] = useState<DhcpLease[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [initialLoadDone, setInitialLoadDone] = useState(false);

  useEffect(() => {
    if (!selectedRouterId) {
      setLeases([]);
      setError(null);
      setInitialLoadDone(false);
      return;
    }
    try {
      const raw = localStorage.getItem(`${LEASES_CACHE_KEY}:${selectedRouterId}`);
      if (raw) {
        const parsed = JSON.parse(raw) as { leases?: DhcpLease[] };
        if (Array.isArray(parsed.leases)) {
          setLeases(parsed.leases);
          setInitialLoadDone(true);
        }
      }
    } catch {
      // Ignore local cache parsing failures.
    }
  }, [selectedRouterId]);

  const loadLeases = async (opts: { background?: boolean } = {}) => {
    if (!selectedRouterId) return;
    setError(null);
    if (opts.background) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/routers/${selectedRouterId}/dhcp-leases`);
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { leases?: DhcpLease[] };
      const next = Array.isArray(data.leases) ? data.leases : [];
      setLeases(next);
      setInitialLoadDone(true);
      try {
        localStorage.setItem(`${LEASES_CACHE_KEY}:${selectedRouterId}`, JSON.stringify({ leases: next, ts: Date.now() }));
      } catch {
        // Ignore storage quota/private mode errors.
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setInitialLoadDone(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!selectedRouterId) return;
    void loadLeases();
  }, [selectedRouterId]);

  const filtered = useMemo(() => {
    const q = foldText(search.trim());
    if (!q) return leases;
    return leases.filter((x) =>
      foldText(x.address).includes(q) ||
      foldText(x.macAddress).includes(q) ||
      foldText(x.activeAddress ?? "").includes(q) ||
      foldText(x.activeMacAddress ?? "").includes(q) ||
      foldText(x.hostName ?? "").includes(q) ||
      foldText(x.server ?? "").includes(q),
    );
  }, [leases, search]);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">DHCP Leases</h1>
          <p className="text-sm text-gray-500">Cache local des baux DHCP, utilisé pour accélérer la résolution IP des bypass MAC.</p>
        </div>
        {selectedRouterId && (
          <Button variant="outline" size="sm" onClick={() => void loadLeases({ background: true })} disabled={loading || refreshing}>
            <RefreshCw className={`h-4 w-4 ${loading || refreshing ? "animate-spin" : ""}`} />
          </Button>
        )}
      </div>

      {!selectedRouterId && (
        <Card>
          <CardContent className="py-16 text-center">
            <Router className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">Sélectionnez un routeur dans la barre latérale</p>
          </CardContent>
        </Card>
      )}

      {selectedRouterId && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-52 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
              <Input className="pl-9" placeholder="Rechercher IP, MAC, hostname..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Badge variant="outline" className="gap-1.5 text-blue-700 border-blue-200">
              <Database className="h-3 w-3" />
              {search ? `${filtered.length} / ${leases.length}` : leases.length} lease(s)
            </Badge>
          </div>

          {error && (
            <Card className="mb-4">
              <CardContent className="py-6 text-red-600 text-sm">{error}</CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Leases DHCP</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table className="min-w-[860px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Adresse</TableHead>
                    <TableHead>MAC Address</TableHead>
                    <TableHead>Server</TableHead>
                    <TableHead>Active Address</TableHead>
                    <TableHead>Active MAC Address</TableHead>
                    <TableHead>Hostname</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead>Expire</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!initialLoadDone && (
                    <>
                      {[...Array(6)].map((_, idx) => (
                        <TableRow key={`sk-${idx}`}>
                          <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                          <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                        </TableRow>
                      ))}
                    </>
                  )}
                  {filtered.map((x) => (
                    <TableRow key={x.id}>
                      <TableCell className="font-mono text-xs">{x.address || "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{x.macAddress || "—"}</TableCell>
                      <TableCell>{x.server || "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{x.activeAddress || "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{x.activeMacAddress || "—"}</TableCell>
                      <TableCell>{x.hostName || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{x.status || (x.dynamic ? "dynamic" : "—")}</Badge>
                      </TableCell>
                      <TableCell>{x.expiresAfter || "—"}</TableCell>
                    </TableRow>
                  ))}
                  {initialLoadDone && !loading && filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-sm text-gray-500 py-10">
                        Aucun lease DHCP trouvé.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
