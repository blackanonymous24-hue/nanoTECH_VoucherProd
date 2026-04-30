import { useEffect, useMemo, useState } from "react";
import { useRouterContext } from "@/contexts/RouterContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  hostName: string | null;
  status: string | null;
  expiresAfter: string | null;
  server: string | null;
  comment: string | null;
  dynamic: boolean;
}

export default function DhcpLeases() {
  const { selectedRouterId } = useRouterContext();
  const [leases, setLeases] = useState<DhcpLease[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedRouterId) {
      setLeases([]);
      setError(null);
      return;
    }
    try {
      const raw = localStorage.getItem(`${LEASES_CACHE_KEY}:${selectedRouterId}`);
      if (raw) {
        const parsed = JSON.parse(raw) as { leases?: DhcpLease[] };
        if (Array.isArray(parsed.leases)) setLeases(parsed.leases);
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
      try {
        localStorage.setItem(`${LEASES_CACHE_KEY}:${selectedRouterId}`, JSON.stringify({ leases: next, ts: Date.now() }));
      } catch {
        // Ignore storage quota/private mode errors.
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
      foldText(x.hostName ?? "").includes(q) ||
      foldText(x.server ?? "").includes(q) ||
      foldText(x.comment ?? "").includes(q),
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
                    <TableHead>MAC</TableHead>
                    <TableHead>Hostname</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead>Expire</TableHead>
                    <TableHead>Serveur</TableHead>
                    <TableHead>Commentaire</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((x) => (
                    <TableRow key={x.id}>
                      <TableCell className="font-mono text-xs">{x.address || "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{x.macAddress || "—"}</TableCell>
                      <TableCell>{x.hostName || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{x.status || (x.dynamic ? "dynamic" : "—")}</Badge>
                      </TableCell>
                      <TableCell>{x.expiresAfter || "—"}</TableCell>
                      <TableCell>{x.server || "—"}</TableCell>
                      <TableCell className="max-w-[260px] truncate" title={x.comment || ""}>{x.comment || "—"}</TableCell>
                    </TableRow>
                  ))}
                  {!loading && filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-sm text-gray-500 py-10">
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
