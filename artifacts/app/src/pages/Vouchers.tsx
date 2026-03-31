import { useState } from "react";
import {
  useListVouchers,
  useDeleteVoucher,
  useMarkVoucherPrinted,
  useSyncRouterVouchers,
  useListRouters,
  getListVouchersQueryKey,
  getGetDashboardQueryKey,
} from "@workspace/api-client-react";
import type { Voucher } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouterContext } from "@/contexts/RouterContext";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Trash2, Printer, Search, RefreshCw, CloudDownload, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

export default function Vouchers() {
  const { data: routers = [] } = useListRouters();
  const { selectedRouterId } = useRouterContext();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [filterRouter, setFilterRouter] = useState<string>("all");
  const [filterPrinted, setFilterPrinted] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [syncRouterId, setSyncRouterId] = useState<string>(
    selectedRouterId ? String(selectedRouterId) : "",
  );
  const [syncResult, setSyncResult] = useState<{ imported: number; skipped: number; total: number } | null>(null);

  const params = {
    routerId: filterRouter !== "all" ? parseInt(filterRouter, 10) : undefined,
    printed: filterPrinted !== "all" ? filterPrinted as "true" | "false" : undefined,
    limit: 100,
  };

  const { data, isLoading, refetch } = useListVouchers(params);
  const deleteMutation = useDeleteVoucher();
  const markPrintedMutation = useMarkVoucherPrinted();
  const syncMutation = useSyncRouterVouchers();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListVouchersQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
  };

  const vouchers = (data?.vouchers ?? []).filter(
    (v) =>
      !search ||
      v.username.includes(search.toLowerCase()) ||
      v.password.includes(search.toLowerCase()) ||
      v.profileName.includes(search.toLowerCase()),
  );

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === vouchers.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(vouchers.map((v) => v.id)));
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Supprimer ce voucher ?")) return;
    await deleteMutation.mutateAsync({ id });
    toast({ title: "Voucher supprimé" });
    invalidate();
  };

  const handleDeleteSelected = async () => {
    if (!selectedIds.size) return;
    if (!confirm(`Supprimer ${selectedIds.size} voucher(s) ?`)) return;
    for (const id of selectedIds) {
      await deleteMutation.mutateAsync({ id });
    }
    setSelectedIds(new Set());
    toast({ title: `${selectedIds.size} voucher(s) supprimé(s)` });
    invalidate();
  };

  const handleMarkPrinted = async (id: number) => {
    await markPrintedMutation.mutateAsync({ id });
    toast({ title: "Marqué comme imprimé" });
    invalidate();
  };

  const handlePrintSelected = () => {
    window.print();
  };

  const openSync = () => {
    setSyncResult(null);
    setSyncRouterId(selectedRouterId ? String(selectedRouterId) : (routers[0] ? String(routers[0].id) : ""));
    setSyncDialogOpen(true);
  };

  const handleSync = async () => {
    if (!syncRouterId) return;
    setSyncResult(null);
    try {
      const result = await syncMutation.mutateAsync({ id: parseInt(syncRouterId, 10) });
      setSyncResult(result);
      invalidate();
      refetch();
    } catch {
      toast({ title: "Erreur de synchronisation", variant: "destructive" });
    }
  };

  const routerName = (id: number) => routers.find((r) => r.id === id)?.name ?? `#${id}`;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vouchers</h1>
          <p className="text-sm text-gray-500">{data?.total ?? 0} voucher(s) au total</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={openSync}
            className="gap-2"
          >
            <CloudDownload className="h-4 w-4" />
            Sync MikroTik
          </Button>
          <button onClick={() => refetch()} className="p-2 rounded-lg hover:bg-gray-200 text-gray-500">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      <Card className="mb-4">
        <CardContent className="py-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
              <Input
                className="pl-8"
                placeholder="Rechercher..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={filterRouter} onValueChange={setFilterRouter}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Tous les routeurs" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les routeurs</SelectItem>
                {routers.map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterPrinted} onValueChange={setFilterPrinted}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Tous les statuts" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous</SelectItem>
                <SelectItem value="false">Non imprimés</SelectItem>
                <SelectItem value="true">Imprimés</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 mb-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5">
          <span className="text-sm text-blue-700 font-medium">{selectedIds.size} sélectionné(s)</span>
          <Button size="sm" variant="outline" onClick={handlePrintSelected} className="gap-1.5">
            <Printer className="h-3.5 w-3.5" /> Imprimer
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleDeleteSelected}
            className="gap-1.5 text-red-500 hover:border-red-300"
          >
            <Trash2 className="h-3.5 w-3.5" /> Supprimer
          </Button>
        </div>
      )}

      <Card>
        <CardHeader className="py-3 px-4">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={selectedIds.size === vouchers.length && vouchers.length > 0}
              onChange={selectAll}
              className="h-4 w-4 rounded"
            />
            <span className="text-xs text-gray-500 font-medium">VOUCHER</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-8 text-center text-gray-400 text-sm">Chargement...</div>
          ) : vouchers.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-sm">
              <p className="mb-2">Aucun voucher trouvé.</p>
              <p className="text-xs">Utilisez "Sync MikroTik" pour importer les utilisateurs existants.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 print:block" id="voucher-print-area">
              {vouchers.map((v) => (
                <VoucherRow
                  key={v.id}
                  voucher={v}
                  selected={selectedIds.has(v.id)}
                  onToggle={() => toggleSelect(v.id)}
                  onDelete={() => handleDelete(v.id)}
                  onMarkPrinted={() => handleMarkPrinted(v.id)}
                  routerName={routerName(v.routerId)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={syncDialogOpen} onOpenChange={(o) => { if (!syncMutation.isPending) setSyncDialogOpen(o); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CloudDownload className="h-5 w-5 text-blue-500" />
              Synchroniser depuis MikroTik
            </DialogTitle>
          </DialogHeader>

          {!syncResult ? (
            <div className="space-y-4 py-2">
              <p className="text-sm text-gray-500">
                Importe tous les utilisateurs hotspot existants depuis le routeur MikroTik dans la base de données locale. Les doublons sont ignorés.
              </p>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Routeur</label>
                <Select value={syncRouterId} onValueChange={setSyncRouterId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionnez un routeur" />
                  </SelectTrigger>
                  <SelectContent>
                    {routers.map((r) => (
                      <SelectItem key={r.id} value={String(r.id)}>
                        {r.name} — {r.host}:{r.port}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter className="pt-2">
                <Button variant="outline" onClick={() => setSyncDialogOpen(false)} disabled={syncMutation.isPending}>
                  Annuler
                </Button>
                <Button
                  onClick={handleSync}
                  disabled={!syncRouterId || syncMutation.isPending}
                  className="gap-2"
                >
                  {syncMutation.isPending ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      Synchronisation...
                    </>
                  ) : (
                    <>
                      <CloudDownload className="h-4 w-4" />
                      Synchroniser
                    </>
                  )}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-3 p-4 bg-green-50 rounded-lg border border-green-200">
                <CheckCircle className="h-6 w-6 text-green-500 flex-shrink-0" />
                <div>
                  <p className="font-medium text-green-800">Synchronisation terminée</p>
                  <p className="text-sm text-green-600">{syncResult.total} utilisateurs traités</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="p-3 bg-blue-50 rounded-lg">
                  <p className="text-2xl font-bold text-blue-600">{syncResult.imported}</p>
                  <p className="text-xs text-blue-500 mt-0.5">Importés</p>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-2xl font-bold text-gray-500">{syncResult.skipped}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Ignorés</p>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-2xl font-bold text-gray-700">{syncResult.total}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Total</p>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => setSyncDialogOpen(false)}>Fermer</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function VoucherRow({
  voucher: v,
  selected,
  onToggle,
  onDelete,
  onMarkPrinted,
  routerName,
}: {
  voucher: Voucher;
  selected: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onMarkPrinted: () => void;
  routerName: string;
}) {
  return (
    <div className={`flex items-center justify-between px-4 py-3 hover:bg-gray-50 ${selected ? "bg-blue-50" : ""}`}>
      <div className="flex items-center gap-3">
        <input type="checkbox" checked={selected} onChange={onToggle} className="h-4 w-4 rounded" />
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold text-sm">{v.username}</span>
            <span className="text-gray-400 font-mono text-sm">/ {v.password}</span>
          </div>
          <div className="text-xs text-gray-400 mt-0.5 flex gap-2">
            <span>{v.profileName}</span>
            <span>·</span>
            <span>{routerName}</span>
            {v.validity && <><span>·</span><span>{v.validity}</span></>}
            {v.price && <><span>·</span><span>{v.price}</span></>}
            {v.comment && <><span>·</span><span className="text-gray-400">{v.comment}</span></>}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {v.printedAt ? (
          <Badge variant="outline" className="text-green-600 border-green-200 text-xs">Imprimé</Badge>
        ) : (
          <Badge variant="outline" className="text-orange-500 border-orange-200 text-xs">En attente</Badge>
        )}
        <span className="text-xs text-gray-400">
          {formatDistanceToNow(new Date(v.createdAt), { addSuffix: true, locale: fr })}
        </span>
        {!v.printedAt && (
          <Button size="sm" variant="ghost" onClick={onMarkPrinted} title="Marquer comme imprimé" className="h-7 w-7 p-0">
            <Printer className="h-3.5 w-3.5 text-gray-400" />
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onDelete} className="h-7 w-7 p-0">
          <Trash2 className="h-3.5 w-3.5 text-red-400" />
        </Button>
      </div>
    </div>
  );
}
