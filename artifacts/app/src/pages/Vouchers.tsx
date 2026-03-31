import { useState, useMemo } from "react";
import {
  useListRouterUsers,
  useListVouchers,
  useMarkVoucherPrinted,
  useDeleteVoucher,
  getListVouchersQueryKey,
  getGetDashboardQueryKey,
} from "@workspace/api-client-react";
import type { HotspotUser, Voucher } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouterContext } from "@/contexts/RouterContext";
import { Card, CardContent } from "@/components/ui/card";
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
import { Printer, Search, RefreshCw, WifiOff, Ticket, ChevronLeft, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { useDebounce } from "@/hooks/use-debounce";

const PAGE_SIZE = 100;

export default function Vouchers() {
  const { selectedRouterId, routers } = useRouterContext();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [filterProfile, setFilterProfile] = useState<string>("all");
  const [filterPrinted, setFilterPrinted] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [selectedUsernames, setSelectedUsernames] = useState<Set<string>>(new Set());

  const debouncedSearch = useDebounce(search, 400);

  const activeRouterId = selectedRouterId ?? null;
  const activeRouter = routers.find((r) => r.id === activeRouterId);

  const queryParams = useMemo(() => ({
    search: debouncedSearch || undefined,
    profile: filterProfile !== "all" ? filterProfile : undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  }), [debouncedSearch, filterProfile, page]);

  const {
    data: usersData,
    isLoading,
    isFetching,
    refetch,
    error,
  } = useListRouterUsers(activeRouterId ?? 0, queryParams, {
    query: {
      enabled: !!activeRouterId,
      refetchInterval: 30_000,
      staleTime: 25_000,
    },
  });

  const mikrotikUsers = usersData?.users ?? [];
  const totalUsers = usersData?.total ?? 0;
  const totalPages = Math.ceil(totalUsers / PAGE_SIZE);

  const { data: localData } = useListVouchers(
    { routerId: activeRouterId ?? undefined, limit: 500 },
    { query: { enabled: !!activeRouterId } },
  );

  const markPrintedMutation = useMarkVoucherPrinted();
  const deleteMutation = useDeleteVoucher();

  const localByUsername = useMemo(
    () => new Map<string, Voucher>((localData?.vouchers ?? []).map((v) => [v.username, v])),
    [localData],
  );

  const filtered = useMemo(() => {
    if (filterPrinted === "all") return mikrotikUsers;
    return mikrotikUsers.filter((u) => {
      const lv = localByUsername.get(u.username);
      if (filterPrinted === "true") return !!lv?.printedAt;
      if (filterPrinted === "false") return !lv?.printedAt;
      return true;
    });
  }, [mikrotikUsers, filterPrinted, localByUsername]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListVouchersQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
  };

  const handleMarkPrinted = async (username: string) => {
    const local = localByUsername.get(username);
    if (local) {
      await markPrintedMutation.mutateAsync({ id: local.id });
      toast({ title: `${username} marqué comme imprimé` });
      invalidate();
    } else {
      toast({ title: "Voucher non enregistré localement", variant: "destructive" });
    }
  };

  const handleDeleteLocal = async (username: string) => {
    const local = localByUsername.get(username);
    if (!local) return;
    if (!confirm(`Supprimer l'entrée locale de ${username} ?`)) return;
    await deleteMutation.mutateAsync({ id: local.id });
    toast({ title: `${username} supprimé` });
    invalidate();
  };

  const toggleSelect = (username: string) => {
    setSelectedUsernames((prev) => {
      const next = new Set(prev);
      if (next.has(username)) next.delete(username);
      else next.add(username);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedUsernames.size === filtered.length) {
      setSelectedUsernames(new Set());
    } else {
      setSelectedUsernames(new Set(filtered.map((u) => u.username)));
    }
  };

  const handleSearchChange = (v: string) => {
    setSearch(v);
    setPage(0);
  };

  const handleProfileChange = (v: string) => {
    setFilterProfile(v);
    setPage(0);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vouchers</h1>
          <p className="text-sm text-gray-500">
            {activeRouter
              ? `${totalUsers.toLocaleString("fr")} voucher(s) — ${activeRouter.name}`
              : "Sélectionnez un routeur dans la barre latérale"}
          </p>
        </div>
        {activeRouterId && (
          <div className="flex items-center gap-2">
            {isFetching && !isLoading && (
              <span className="text-xs text-gray-400 flex items-center gap-1">
                <RefreshCw className="h-3 w-3 animate-spin" /> Mise à jour...
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              Actualiser
            </Button>
          </div>
        )}
      </div>

      {!activeRouterId ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Ticket className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">Aucun routeur sélectionné</p>
            <p className="text-sm text-gray-400 mt-1">
              Choisissez un routeur dans "ROUTEUR ACTIF" dans la barre de gauche
            </p>
          </CardContent>
        </Card>
      ) : error ? (
        <Card>
          <CardContent className="py-12 text-center">
            <WifiOff className="h-10 w-10 text-red-300 mx-auto mb-3" />
            <p className="text-red-500 font-medium">Impossible de contacter le routeur</p>
            <p className="text-sm text-gray-400 mt-1">Vérifiez la connexion et réessayez</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" /> Réessayer
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="mb-4">
            <CardContent className="py-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-48">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                  <Input
                    className="pl-8"
                    placeholder="Rechercher par code, nom, commentaire..."
                    value={search}
                    onChange={(e) => handleSearchChange(e.target.value)}
                  />
                </div>
                <Select value={filterProfile} onValueChange={handleProfileChange}>
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Tous les forfaits" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les forfaits</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={filterPrinted} onValueChange={setFilterPrinted}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="Tous" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous</SelectItem>
                    <SelectItem value="false">Non imprimés</SelectItem>
                    <SelectItem value="true">Imprimés</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-xs text-gray-400">↻ 30s</span>
              </div>
            </CardContent>
          </Card>

          {selectedUsernames.size > 0 && (
            <div className="flex items-center gap-3 mb-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5">
              <span className="text-sm text-blue-700 font-medium">{selectedUsernames.size} sélectionné(s)</span>
              <Button size="sm" variant="outline" onClick={() => window.print()} className="gap-1.5">
                <Printer className="h-3.5 w-3.5" /> Imprimer
              </Button>
            </div>
          )}

          <Card>
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedUsernames.size === filtered.length && filtered.length > 0}
                  onChange={selectAll}
                  className="h-4 w-4 rounded"
                />
                <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">Voucher</span>
              </div>
              <span className="text-xs text-gray-400">
                {filtered.length} / {totalUsers.toLocaleString("fr")} affiché(s)
              </span>
            </div>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="py-12 text-center text-gray-400 text-sm">
                  <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-3 text-gray-300" />
                  Chargement depuis le routeur...
                </div>
              ) : filtered.length === 0 ? (
                <div className="py-8 text-center text-gray-400 text-sm">Aucun voucher trouvé.</div>
              ) : (
                <div className="divide-y divide-gray-100 print:block" id="voucher-print-area">
                  {filtered.map((user) => (
                    <UserRow
                      key={user.username}
                      user={user}
                      localVoucher={localByUsername.get(user.username)}
                      selected={selectedUsernames.has(user.username)}
                      onToggle={() => toggleSelect(user.username)}
                      onMarkPrinted={() => handleMarkPrinted(user.username)}
                      onDeleteLocal={() => handleDeleteLocal(user.username)}
                    />
                  ))}
                </div>
              )}
            </CardContent>

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0 || isFetching}
                  className="gap-1"
                >
                  <ChevronLeft className="h-4 w-4" /> Précédent
                </Button>
                <span className="text-xs text-gray-500">
                  Page {page + 1} / {totalPages} ({totalUsers.toLocaleString("fr")} total)
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1 || isFetching}
                  className="gap-1"
                >
                  Suivant <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function UserRow({
  user,
  localVoucher,
  selected,
  onToggle,
  onMarkPrinted,
  onDeleteLocal,
}: {
  user: HotspotUser;
  localVoucher?: Voucher;
  selected: boolean;
  onToggle: () => void;
  onMarkPrinted: () => void;
  onDeleteLocal: () => void;
}) {
  const isPrinted = !!localVoucher?.printedAt;

  return (
    <div className={`flex items-center justify-between px-4 py-3 hover:bg-gray-50 ${selected ? "bg-blue-50" : ""}`}>
      <div className="flex items-center gap-3">
        <input type="checkbox" checked={selected} onChange={onToggle} className="h-4 w-4 rounded" />
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold text-sm">{user.username}</span>
            <span className="text-gray-400 font-mono text-sm">/ {user.password}</span>
          </div>
          <div className="text-xs text-gray-400 mt-0.5 flex flex-wrap gap-2">
            <span>{user.profile}</span>
            {user.comment && <><span>·</span><span>{user.comment}</span></>}
            {user.limitUptime && <><span>·</span><span>{user.limitUptime}</span></>}
            {user.macAddress && <><span>·</span><span className="font-mono">{user.macAddress}</span></>}
            {user.disabled && <><span>·</span><span className="text-orange-400">désactivé</span></>}
            {localVoucher?.price && <><span>·</span><span>{localVoucher.price}</span></>}
            {localVoucher?.createdAt && (
              <><span>·</span><span>{formatDistanceToNow(new Date(localVoucher.createdAt), { addSuffix: true, locale: fr })}</span></>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {isPrinted ? (
          <Badge variant="outline" className="text-green-600 border-green-200 text-xs">Imprimé</Badge>
        ) : localVoucher ? (
          <Badge variant="outline" className="text-orange-500 border-orange-200 text-xs">En attente</Badge>
        ) : (
          <Badge variant="outline" className="text-gray-400 border-gray-200 text-xs">MikroTik</Badge>
        )}
        {!isPrinted && localVoucher && (
          <Button size="sm" variant="ghost" onClick={onMarkPrinted} title="Marquer comme imprimé" className="h-7 w-7 p-0">
            <Printer className="h-3.5 w-3.5 text-gray-400" />
          </Button>
        )}
        {localVoucher && (
          <Button size="sm" variant="ghost" onClick={onDeleteLocal} className="h-7 w-7 p-0" title="Supprimer l'entrée locale">
            <span className="text-red-300 text-xs">✕</span>
          </Button>
        )}
      </div>
    </div>
  );
}
