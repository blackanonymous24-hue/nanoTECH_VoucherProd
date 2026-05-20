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
import { CalendarClock, RefreshCw, Router, Search, Trash2 } from "lucide-react";
import { foldText } from "@/lib/text";
import { sortMikrotikRowsByCreationOrder } from "@/lib/routerProfilesSort";
import { useToast } from "@/hooks/use-toast";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { useAuth } from "@/contexts/AuthContext";
import { canDelete } from "@/lib/permissions";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface ProfileScheduler {
  id: string;
  name: string;
  interval: string | null;
  onEventPreview: string | null;
  startDate: string | null;
  startTime: string | null;
  disabled: boolean;
  comment: string | null;
  nextRun: string | null;
  matchesProfile: boolean;
}

export default function ProfileSchedulers() {
  const { selectedRouterId } = useRouterContext();
  const { role } = useAuth();
  const allowDelete = canDelete(role);
  const { toast } = useToast();
  const [schedulers, setSchedulers] = useState<ProfileScheduler[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProfileScheduler | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadSchedulers = async (opts: { background?: boolean } = {}) => {
    if (!selectedRouterId) return;
    setError(null);
    if (opts.background) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/routers/${selectedRouterId}/profile-schedulers`);
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { schedulers?: ProfileScheduler[] };
      const list = Array.isArray(data.schedulers) ? data.schedulers : [];
      setSchedulers(sortMikrotikRowsByCreationOrder(list));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!selectedRouterId) {
      setSchedulers([]);
      setError(null);
      return;
    }
    void loadSchedulers();
  }, [selectedRouterId]);

  const filtered = useMemo(() => {
    const q = foldText(search.trim());
    if (!q) return schedulers;
    return schedulers.filter((s) =>
      foldText(s.name).includes(q)
      || foldText(s.interval ?? "").includes(q)
      || foldText(s.comment ?? "").includes(q)
      || foldText(s.onEventPreview ?? "").includes(q),
    );
  }, [schedulers, search]);

  const confirmDelete = async () => {
    if (!selectedRouterId || !pendingDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `${BASE}/api/routers/${selectedRouterId}/profile-schedulers/${encodeURIComponent(pendingDelete.id)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setSchedulers((prev) => prev.filter((s) => s.id !== pendingDelete.id));
      toast({ title: "Scheduler supprimé", description: pendingDelete.name });
      setPendingDelete(null);
    } catch (err) {
      toast({
        title: "Suppression échouée",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Schedulers profils</h1>
          <p className="text-sm text-gray-500 mt-1">
            Moniteurs d&apos;expiration des forfaits hotspot (Mikhmon / MikroTik).
          </p>
        </div>
        {selectedRouterId && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadSchedulers({ background: true })}
            disabled={loading || refreshing || deleting}
            title="Rafraîchir"
          >
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
          {error && (
            <Card className="mb-4">
              <CardContent className="py-6 text-red-600 text-sm">{error}</CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="space-y-1.5 pb-2.5 border-b border-gray-100 bg-white relative z-10">
              <CardTitle className="text-base flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-blue-500" />
                Schedulers profils
              </CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-52 max-w-sm">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
                  <Input
                    className="h-7 min-h-7 sm:h-7 py-0 pl-8 pr-2 text-xs leading-none placeholder:text-xs"
                    placeholder="Rechercher nom, intervalle..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <Badge variant="outline" className="h-7 gap-1 px-2 py-0 text-[11px] leading-none text-blue-700 border-blue-200 shrink-0">
                  <CalendarClock className="h-3 w-3 shrink-0" />
                  {search ? `${filtered.length} / ${schedulers.length}` : schedulers.length} scheduler(s)
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="hotspot-table-scroll max-h-[min(70dvh,560px)] overflow-auto overscroll-contain scroll-card">
                <Table className="min-w-[900px]">
                  <TableHeader>
                    <TableRow className="bg-gray-50 [&_th]:h-7 [&_th]:py-0 [&_th]:leading-tight">
                      {allowDelete && <TableHead className="w-12 text-center">Action</TableHead>}
                      <TableHead>Nom (forfait)</TableHead>
                      <TableHead>Intervalle</TableHead>
                      <TableHead>État</TableHead>
                      <TableHead>Prochaine exéc.</TableHead>
                      <TableHead>Script (aperçu)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading && schedulers.length === 0 ? (
                      Array.from({ length: 6 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell colSpan={allowDelete ? 6 : 5}><Skeleton className="h-6 w-full" /></TableCell>
                        </TableRow>
                      ))
                    ) : filtered.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={allowDelete ? 6 : 5} className="text-center text-sm text-gray-500 py-10">
                          {schedulers.length === 0
                            ? "Aucun scheduler de profil sur ce routeur."
                            : "Aucun résultat pour cette recherche."}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filtered.map((s) => (
                        <TableRow key={s.id} className="hover:bg-gray-50/80">
                          {allowDelete && (
                          <TableCell className="text-center">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-red-600 hover:text-red-700 hover:bg-red-50"
                              disabled={deleting || loading || refreshing}
                              title="Supprimer le scheduler"
                              onClick={() => setPendingDelete(s)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                          )}
                          <TableCell className="font-medium text-sm">
                            <span className="inline-flex items-center gap-1.5">
                              <span
                                className={`h-2 w-2 rounded-full shrink-0 ${
                                  s.disabled
                                    ? "bg-orange-400"
                                    : s.matchesProfile
                                      ? "bg-emerald-500"
                                      : "bg-gray-400"
                                }`}
                                title={
                                  s.disabled
                                    ? "Désactivé"
                                    : s.matchesProfile
                                      ? "Actif — forfait présent"
                                      : "Orphelin (forfait absent)"
                                }
                              />
                              {s.name}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs font-mono text-gray-700">{s.interval ?? "—"}</TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={
                                s.disabled
                                  ? "text-orange-700 border-orange-200 bg-orange-50"
                                  : "text-emerald-700 border-emerald-200 bg-emerald-50"
                              }
                            >
                              {s.disabled ? "Désactivé" : "Actif"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-gray-600">{s.nextRun ?? "—"}</TableCell>
                          <TableCell className="text-[10px] text-gray-500 max-w-xs truncate" title={s.onEventPreview ?? undefined}>
                            {s.onEventPreview ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {allowDelete && (
      <DeleteConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => { if (!open && !deleting) setPendingDelete(null); }}
        title="Supprimer ce scheduler ?"
        description={
          pendingDelete ? (
            <>
              Le moniteur <strong>{pendingDelete.name}</strong> sera retiré du routeur MikroTik.
              Le forfait ne sera plus surveillé automatiquement (point orange dans Générer un ticket).
            </>
          ) : null
        }
        onConfirm={() => void confirmDelete()}
        loading={deleting}
        confirmLabel="Supprimer"
      />
      )}
    </div>
  );
}
