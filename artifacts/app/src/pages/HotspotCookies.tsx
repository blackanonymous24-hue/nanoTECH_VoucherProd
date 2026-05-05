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
import { Cookie, RefreshCw, Search, Router, Trash2 } from "lucide-react";
import { foldText } from "@/lib/text";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const COOKIES_CACHE_KEY = "hotspot-cookies-cache:v1";

interface HotspotCookie {
  id: string;
  user: string | null;
  macAddress: string | null;
  address: string | null;
  server: string | null;
  expiresIn: string | null;
  domain: string | null;
  path: string | null;
}

export default function HotspotCookies() {
  const { selectedRouterId } = useRouterContext();
  const { toast } = useToast();
  const [cookies, setCookies] = useState<HotspotCookie[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [busyCookieId, setBusyCookieId] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);

  useEffect(() => {
    if (!selectedRouterId) {
      setCookies([]);
      setError(null);
      setInitialLoadDone(false);
      return;
    }
    setLoading(true);
    try {
      const raw = localStorage.getItem(`${COOKIES_CACHE_KEY}:${selectedRouterId}`);
      if (raw) {
        const parsed = JSON.parse(raw) as { cookies?: HotspotCookie[] };
        if (Array.isArray(parsed.cookies)) {
          setCookies(parsed.cookies);
          setInitialLoadDone(true);
        }
      }
    } catch {
      // ignore local cache parsing failures
    }
  }, [selectedRouterId]);

  const loadCookies = async (opts: { background?: boolean } = {}) => {
    if (!selectedRouterId) return;
    setError(null);
    if (opts.background) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/routers/${selectedRouterId}/hotspot-cookies`);
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { cookies?: HotspotCookie[] };
      const next = Array.isArray(data.cookies) ? data.cookies : [];
      setCookies(next);
      setInitialLoadDone(true);
      try {
        localStorage.setItem(`${COOKIES_CACHE_KEY}:${selectedRouterId}`, JSON.stringify({ cookies: next, ts: Date.now() }));
      } catch {
        // ignore storage errors
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
    setInitialLoadDone(false);
    void loadCookies();
  }, [selectedRouterId]);

  const filtered = useMemo(() => {
    const q = foldText(search.trim());
    if (!q) return cookies;
    return cookies.filter((x) =>
      foldText(x.user ?? "").includes(q) ||
      foldText(x.macAddress ?? "").includes(q) ||
      foldText(x.address ?? "").includes(q) ||
      foldText(x.server ?? "").includes(q) ||
      foldText(x.domain ?? "").includes(q),
    );
  }, [cookies, search]);

  const handleDeleteCookie = async (cookie: HotspotCookie) => {
    if (!selectedRouterId || !cookie.id || busyCookieId || clearingAll) return;
    setBusyCookieId(cookie.id);
    try {
      const res = await fetch(`${BASE}/api/routers/${selectedRouterId}/hotspot-cookies/${encodeURIComponent(cookie.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setCookies((prev) => prev.filter((x) => x.id !== cookie.id));
      toast({ title: "Cookie supprimé" });
    } catch (err) {
      toast({ title: "Suppression échouée", description: String(err), variant: "destructive" });
    } finally {
      setBusyCookieId(null);
    }
  };

  const handleClearAll = async () => {
    if (!selectedRouterId || clearingAll || busyCookieId) return;
    const ok = window.confirm("Supprimer tous les cookies hotspot de ce routeur ?");
    if (!ok) return;
    setClearingAll(true);
    try {
      const res = await fetch(`${BASE}/api/routers/${selectedRouterId}/hotspot-cookies`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string; removed?: number };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setCookies([]);
      toast({ title: "Cookies supprimés", description: `${Number(data.removed ?? 0)} cookie(s) supprimé(s)` });
    } catch (err) {
      toast({ title: "Suppression échouée", description: String(err), variant: "destructive" });
    } finally {
      setClearingAll(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cookies Hotspot</h1>
        </div>
        {selectedRouterId && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadCookies({ background: true })}
              disabled={loading || refreshing || clearingAll || !!busyCookieId}
              title="Rafraîchir"
            >
              <RefreshCw className={`h-4 w-4 ${loading || refreshing ? "animate-spin" : ""}`} />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleClearAll()}
              disabled={loading || refreshing || clearingAll || !!busyCookieId || cookies.length === 0}
              className="text-red-600 hover:text-red-700"
            >
              {clearingAll ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </Button>
          </div>
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
              <Input className="pl-9" placeholder="Rechercher utilisateur, MAC, IP..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Badge variant="outline" className="gap-1.5 text-blue-700 border-blue-200">
              <Cookie className="h-3 w-3" />
              {search ? `${filtered.length} / ${cookies.length}` : cookies.length} cookie(s)
            </Badge>
          </div>

          {error && (
            <Card className="mb-4">
              <CardContent className="py-6 text-red-600 text-sm">{error}</CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Cookies Hotspot</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table className="min-w-[760px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12 text-center">Action</TableHead>
                    <TableHead>Utilisateur</TableHead>
                    <TableHead>Adresse MAC</TableHead>
                    <TableHead>Domaine</TableHead>
                    <TableHead>Expire dans</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!initialLoadDone && (
                    <>
                      {[...Array(6)].map((_, idx) => (
                        <TableRow key={`sk-${idx}`}>
                          <TableCell><Skeleton className="h-8 w-8 mx-auto" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                        </TableRow>
                      ))}
                    </>
                  )}
                  {filtered.map((x) => (
                    <TableRow key={x.id}>
                      <TableCell className="text-center">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          onClick={() => void handleDeleteCookie(x)}
                          disabled={!!busyCookieId || clearingAll}
                          title="Supprimer ce cookie"
                        >
                          {busyCookieId === x.id ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </Button>
                      </TableCell>
                      <TableCell className="font-medium">{x.user || "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{x.macAddress || "—"}</TableCell>
                      <TableCell>{x.domain || "—"}</TableCell>
                      <TableCell>{x.expiresIn || "—"}</TableCell>
                    </TableRow>
                  ))}
                  {initialLoadDone && !loading && filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-sm text-gray-500 py-10">
                        Aucun cookie hotspot trouvé.
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
