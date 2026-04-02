import { useState, useMemo } from "react";
import {
  useListRouterUsers,
  useListRouterProfiles,
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Printer,
  Search,
  RefreshCw,
  WifiOff,
  Ticket,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Table2,
  Trash2,
  Package,
  List,
  PowerOff,
  Check,
  ChevronsUpDown,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow, format } from "date-fns";
import { fr } from "date-fns/locale";
import { useDebounce } from "@/hooks/use-debounce";
import { applyVars, getStoredTemplate, getStoredPHP, isPHPMode } from "@/pages/TicketTemplate";

const PAGE_SIZE = 100;
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Print helpers ────────────────────────────────────────────────────────────

function getPriceColor(price: string | number | null | undefined): string {
  const map: Record<string, string> = {
    "0": "#E50877", "100": "#752CEB", "200": "#804000",
    "300": "#13C013", "500": "#ECA352", "1000": "#F75418",
    "1500": "#FF69B4", "2500": "#F70000", "3000": "#F70000",
    "13000": "#2E8B57", "15000": "#2E8B57",
    "17000": "#0000FF", "20000": "#0000FF",
    "35000": "#6495ED", "40000": "#6495ED",
    "80000": "#FF8C00", "85000": "#FF8C00",
    "160000": "#DC143C", "170000": "#DC143C",
  };
  return map[String(price ?? "")] ?? "#1433FD";
}

function formatValidityLabel(v: string | null | undefined): string {
  if (!v) return "";
  const last = v.slice(-1);
  const num = v.slice(0, -1);
  if (last === "d") return `Validité : ${num} Jour(s)`;
  if (last === "h") return `Validité : ${num} Heure(s)`;
  if (last === "w") return `Validité : ${num} Semaine(s)`;
  return v;
}

function formatUptimeLabel(v: string | null | undefined): string {
  if (!v) return "";
  const last = v.slice(-1);
  const num = v.slice(0, -1);
  if (last === "d") return `Durée : ${num} Jour(s)`;
  if (last === "h") return `Durée : ${num} Heure(s)`;
  if (last === "w") return `Durée : ${num} Semaine(s)`;
  return v;
}

// ─────────────────────────────────────────────────────────────────────────────

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Vouchers() {
  const { selectedRouterId, routers } = useRouterContext();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [view, setView] = useState<"list" | "lots">("list");
  const [search, setSearch] = useState("");
  const [filterProfile, setFilterProfile] = useState<string>("all");
  const [filterComment, setFilterComment] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [selectedUsernames, setSelectedUsernames] = useState<Set<string>>(new Set());
  const [deletingLot, setDeletingLot] = useState<string | null>(null);
  const [isDisabling, setIsDisabling] = useState(false);
  const [profilePopoverOpen, setProfilePopoverOpen] = useState(false);
  const [commentPopoverOpen, setCommentPopoverOpen] = useState(false);

  const debouncedSearch = useDebounce(search, 400);

  const activeRouterId = selectedRouterId ?? null;
  const activeRouter = routers.find((r) => r.id === activeRouterId);

  const queryParams = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      profile: filterProfile !== "all" ? filterProfile : undefined,
      comment: filterComment !== "all" ? filterComment : undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [debouncedSearch, filterProfile, filterComment, page],
  );

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

  const { data: profilesList = [] } = useListRouterProfiles(activeRouterId ?? 0, {
    query: { enabled: !!activeRouterId, staleTime: 60_000 },
  });

  const { data: localData, refetch: refetchLocal } = useListVouchers(
    { routerId: activeRouterId ?? undefined, limit: 10000 },
    { query: { enabled: !!activeRouterId } },
  );

  const allLocalVouchers = localData?.vouchers ?? [];

  const markPrintedMutation = useMarkVoucherPrinted();
  const deleteMutation = useDeleteVoucher();

  const localByUsername = useMemo(
    () => new Map<string, Voucher>(allLocalVouchers.map((v) => [v.username, v])),
    [allLocalVouchers],
  );

  // Unique "vc" comments with per-lot count from ALL local vouchers
  const uniqueComments = useMemo(() => {
    const counts = new Map<string, number>();
    for (const v of allLocalVouchers) {
      const c = v.comment;
      if (c && c.startsWith("vc")) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    // sort by date part "MM.DD.YY" (index 2 after split by "-"), newest first
    const datePart = (n: string) => {
      const parts = n.split("-");
      if (parts.length < 3) return n;
      const [mm, dd, yy] = parts.slice(2).join("-").split(".");
      return `${yy ?? "00"}.${mm ?? "00"}.${dd ?? "00"}`;
    };
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => {
        const cmp = datePart(b.name).localeCompare(datePart(a.name));
        return cmp !== 0 ? cmp : b.name.localeCompare(a.name);
      });
  }, [allLocalVouchers]);

  const filtered = mikrotikUsers;

  const lots = useMemo(() => {
    const map = new Map<string, Voucher[]>();
    for (const v of allLocalVouchers) {
      const key = v.comment ?? "— Sans lot —";
      const arr = map.get(key) ?? [];
      arr.push(v);
      map.set(key, arr);
    }
    return Array.from(map.entries())
      .map(([name, vouchers]) => ({
        name,
        vouchers,
        count: vouchers.length,
        date: vouchers.reduce((min, v) =>
          v.createdAt && (!min || v.createdAt < min) ? v.createdAt : min,
          "" as string,
        ),
        profile: vouchers.every((v) => v.profileName === vouchers[0].profileName)
          ? vouchers[0].profileName
          : null,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [allLocalVouchers]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListVouchersQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
    refetchLocal();
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

  const handleDeleteLot = async (lotName: string) => {
    const lot = lots.find((l) => l.name === lotName);
    if (!lot) return;
    let deleted = 0;
    for (const v of lot.vouchers) {
      await deleteMutation.mutateAsync({ id: v.id });
      deleted++;
    }
    toast({ title: `Lot « ${lotName} » supprimé`, description: `${deleted} voucher(s) retirés de la base locale` });
    invalidate();
    setDeletingLot(null);
    if (filterComment === lotName) setFilterComment("all");
  };

  const handlePrintVouchers = async () => {
    if (!isPHPMode()) { window.print(); return; }
    const php = getStoredPHP()!;
    const usersForPrint = selectedUsernames.size > 0
      ? filtered.filter((u) => selectedUsernames.has(u.username))
      : filtered;
    const vouchers = usersForPrint.map((user, idx) => {
      const lv = localByUsername.get(user.username);
      return {
        hotspotname: activeRouter?.name ?? "",
        dnsname: (activeRouter as any)?.contact ?? "",
        username: user.username,
        password: user.password,
        price: String(lv?.price ?? ""),
        currency: "FCFA",
        validity: lv?.validity ?? "",
        timelimit: user.limitUptime ?? "",
        datalimit: user.limitBytesTotal ?? "",
        num: idx + 1,
      };
    });
    try {
      const resp = await fetch(`${BASE}/api/render-tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ php, vouchers }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      const sec = document.getElementById("voucher-print-section");
      if (sec) {
        sec.innerHTML = (data.html as string[]).join("");
        sec.style.display = "flex";
        sec.style.flexWrap = "wrap";
      }
      window.print();
      if (sec) { sec.innerHTML = ""; sec.style.display = "none"; }
    } catch (err: unknown) {
      toast({ title: "Erreur impression PHP", description: String(err), variant: "destructive" });
    }
  };

  const handleExportTxt = (lot: { name: string; vouchers: Voucher[] }) => {
    const lines = lot.vouchers.map((v) => `${v.username} / ${v.password}`).join("\n");
    downloadFile(lines, `${lot.name}.txt`, "text/plain;charset=utf-8");
  };

  const handleExportCsv = (lot: { name: string; vouchers: Voucher[] }) => {
    const header = "username,password,profil,validite,prix,lot,date";
    const rows = lot.vouchers.map((v) =>
      [
        v.username,
        v.password,
        v.profileName ?? "",
        v.validity ?? "",
        v.price ?? "",
        v.comment ?? "",
        v.createdAt ? format(new Date(v.createdAt), "yyyy-MM-dd HH:mm") : "",
      ]
        .map((s) => `"${String(s).replace(/"/g, '""')}"`)
        .join(","),
    );
    downloadFile([header, ...rows].join("\n"), `${lot.name}.csv`, "text/csv;charset=utf-8");
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

  const handleCommentChange = (v: string) => {
    setFilterComment(v);
    setPage(0);
  };

  const handleDisableLot = async (comment: string, enable: boolean) => {
    if (!activeRouterId) return;
    setIsDisabling(true);
    try {
      const res = await fetch(`${BASE}/api/vouchers/lot-disable`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routerId: activeRouterId, comment, enable }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { done: number; notFound: string[] };
      toast({
        title: enable
          ? `${data.done} voucher(s) réactivé(s)`
          : `${data.done} voucher(s) désactivé(s)`,
        description: `Lot : ${comment}`,
      });
      refetch();
    } catch {
      toast({ title: "Erreur lors de la désactivation", variant: "destructive" });
    } finally {
      setIsDisabling(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
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
            {isFetching && !isLoading && view === "list" && (
              <span className="text-xs text-gray-400 flex items-center gap-1">
                <RefreshCw className="h-3 w-3 animate-spin" /> Mise à jour...
              </span>
            )}
            {view === "list" && (
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
            )}
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
      ) : error && view === "list" ? (
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
          {/* Tab toggle */}
          <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
            <button
              onClick={() => setView("list")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                view === "list"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <List className="h-3.5 w-3.5" /> Liste MikroTik
            </button>
            <button
              onClick={() => setView("lots")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                view === "lots"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <Package className="h-3.5 w-3.5" /> Lots
              {lots.length > 0 && (
                <span className="bg-blue-100 text-blue-700 text-xs px-1.5 py-0.5 rounded-full">
                  {lots.length}
                </span>
              )}
            </button>
          </div>

          {/* ─── LIST VIEW ─── */}
          {view === "list" && (
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
                    {/* Combobox — Forfait */}
                    <Popover open={profilePopoverOpen} onOpenChange={setProfilePopoverOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={profilePopoverOpen}
                          className="w-48 justify-between font-normal"
                        >
                          <span className="truncate">
                            {filterProfile === "all" ? "Tous les forfaits" : filterProfile}
                          </span>
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-48 p-0" align="start">
                        <Command>
                          <CommandList>
                            <CommandEmpty>Aucun forfait.</CommandEmpty>
                            <CommandGroup>
                              <CommandItem
                                value="all"
                                onSelect={() => { handleProfileChange("all"); setProfilePopoverOpen(false); }}
                              >
                                <Check className={`mr-2 h-4 w-4 ${filterProfile === "all" ? "opacity-100" : "opacity-0"}`} />
                                Tous les forfaits
                              </CommandItem>
                              {profilesList.map((p) => (
                                <CommandItem
                                  key={p.name}
                                  value={p.name}
                                  onSelect={() => { handleProfileChange(p.name); setProfilePopoverOpen(false); }}
                                >
                                  <Check className={`mr-2 h-4 w-4 ${filterProfile === p.name ? "opacity-100" : "opacity-0"}`} />
                                  {p.name}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>

                    {/* Combobox — Lot */}
                    <Popover open={commentPopoverOpen} onOpenChange={setCommentPopoverOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={commentPopoverOpen}
                          className="w-52 justify-between font-normal"
                        >
                          <span className="font-mono text-xs truncate">
                            {filterComment === "all" ? "Tous les lots" : filterComment}
                          </span>
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto min-w-52 max-w-sm p-0" align="start">
                        <Command>
                          <CommandList>
                            <CommandEmpty>Aucun lot.</CommandEmpty>
                            <CommandGroup>
                              <CommandItem
                                value="all"
                                onSelect={() => { handleCommentChange("all"); setCommentPopoverOpen(false); }}
                              >
                                <Check className={`mr-2 h-4 w-4 ${filterComment === "all" ? "opacity-100" : "opacity-0"}`} />
                                Tous
                              </CommandItem>
                              {uniqueComments.map(({ name, count }) => (
                                <CommandItem
                                  key={name}
                                  value={name}
                                  onSelect={() => { handleCommentChange(name); setCommentPopoverOpen(false); }}
                                >
                                  <Check className={`mr-2 h-4 w-4 ${filterComment === name ? "opacity-100" : "opacity-0"}`} />
                                  <span className="font-mono text-xs whitespace-nowrap flex-1">{name}</span>
                                  <span className="text-xs text-green-600 ml-2">({count})</span>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    <span className="text-xs text-gray-400">↻ 30s</span>
                  </div>
                </CardContent>
              </Card>

              {filterComment !== "all" && (
                <div className="flex items-center justify-between mb-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 gap-3 flex-wrap">
                  <span className="text-sm text-amber-800 font-medium flex items-center gap-2">
                    <Package className="h-4 w-4" />
                    Lot&nbsp;: <span className="font-mono">{filterComment}</span>
                    &nbsp;—&nbsp;{filtered.length} affiché(s)
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isDisabling}
                      onClick={() => handleDisableLot(filterComment, false)}
                      className="gap-1.5 text-orange-600 hover:text-orange-800 hover:bg-orange-50"
                    >
                      <PowerOff className="h-3.5 w-3.5" />
                      {isDisabling ? "En cours..." : "Désactiver"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isDisabling}
                      onClick={() => handleDisableLot(filterComment, true)}
                      className="gap-1.5 text-green-600 hover:text-green-800 hover:bg-green-50"
                    >
                      <PowerOff className="h-3.5 w-3.5 rotate-180" />
                      {isDisabling ? "En cours..." : "Réactiver"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handlePrintVouchers}
                      className="gap-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-50"
                    >
                      <Printer className="h-3.5 w-3.5" /> Imprimer
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDeletingLot(filterComment)}
                      className="gap-1.5 text-red-500 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Supprimer
                    </Button>
                  </div>
                </div>
              )}

              {selectedUsernames.size > 0 && (
                <div className="flex items-center gap-3 mb-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5">
                  <span className="text-sm text-blue-700 font-medium">
                    {selectedUsernames.size} sélectionné(s)
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handlePrintVouchers}
                    className="gap-1.5"
                  >
                    <Printer className="h-3.5 w-3.5" /> Imprimer
                  </Button>
                </div>
              )}

              <Card>
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={
                        selectedUsernames.size === filtered.length && filtered.length > 0
                      }
                      onChange={selectAll}
                      className="h-4 w-4 rounded"
                    />
                    <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">
                      Voucher
                    </span>
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
                    <div className="py-8 text-center text-gray-400 text-sm">
                      Aucun voucher trouvé.
                    </div>
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

          {/* ─── LOTS VIEW ─── */}
          {view === "lots" && (
            <>
              {lots.length === 0 ? (
                <Card>
                  <CardContent className="py-16 text-center">
                    <Package className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500 font-medium">Aucun lot enregistré</p>
                    <p className="text-sm text-gray-400 mt-1">
                      Générez des vouchers pour créer votre premier lot
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {lots.map((lot) => (
                    <Card key={lot.name} className="overflow-hidden">
                      <div className="flex items-center justify-between px-5 py-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <Package className="h-5 w-5 text-blue-400 flex-shrink-0" />
                          <div className="min-w-0">
                            <p className="font-mono font-semibold text-gray-900 text-sm break-all">
                              {lot.name}
                            </p>
                            <div className="flex flex-wrap items-center gap-2 mt-0.5">
                              <span className="text-xs text-gray-400">
                                {lot.count} voucher(s)
                              </span>
                              {lot.profile && (
                                <>
                                  <span className="text-gray-300">·</span>
                                  <span className="text-xs text-gray-400">{lot.profile}</span>
                                </>
                              )}
                              {lot.date && (
                                <>
                                  <span className="text-gray-300">·</span>
                                  <span className="text-xs text-gray-400">
                                    {formatDistanceToNow(new Date(lot.date), {
                                      addSuffix: true,
                                      locale: fr,
                                    })}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 text-xs"
                            onClick={() => handleExportTxt(lot)}
                            title="Exporter en .txt"
                          >
                            <FileText className="h-3.5 w-3.5" /> .txt
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 text-xs"
                            onClick={() => handleExportCsv(lot)}
                            title="Exporter en .csv"
                          >
                            <Table2 className="h-3.5 w-3.5" /> .csv
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1.5 text-xs text-red-400 hover:text-red-600 hover:bg-red-50"
                            onClick={() => setDeletingLot(lot.name)}
                            title="Supprimer ce lot"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>

                      {/* Preview: first 3 vouchers */}
                      <div className="border-t border-gray-100 bg-gray-50 px-5 py-2 flex flex-wrap gap-3">
                        {lot.vouchers.slice(0, 4).map((v) => (
                          <span key={v.id} className="font-mono text-xs text-gray-500">
                            {v.username} / {v.password}
                          </span>
                        ))}
                        {lot.count > 4 && (
                          <span className="text-xs text-gray-400">
                            +{lot.count - 4} autres
                          </span>
                        )}
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Delete lot confirmation */}
      <AlertDialog open={!!deletingLot} onOpenChange={(o) => { if (!o) setDeletingLot(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer le lot ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le lot <strong className="font-mono">{deletingLot}</strong> et tous ses vouchers seront
              supprimés de la base locale. Les comptes MikroTik ne seront pas affectés.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deletingLot && handleDeleteLot(deletingLot)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Suppression..." : "Supprimer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Hidden download icon for accessibility */}
      <Download className="hidden" />

      {/* ── Print section — hidden on screen, visible on print ── */}
      <div id="voucher-print-section" style={{ display: "none" }}>
        {(selectedUsernames.size > 0
          ? filtered.filter((u) => selectedUsernames.has(u.username))
          : filtered
        ).map((user, idx) => (
          <VoucherPrintCard
            key={user.username}
            user={user}
            localVoucher={localByUsername.get(user.username)}
            hotspotName={activeRouter?.name ?? ""}
            dnsName={(activeRouter as any)?.contact ?? ""}
            num={idx + 1}
          />
        ))}
      </div>
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
    <div
      className={`flex items-center justify-between px-3 sm:px-4 py-3 hover:bg-gray-50 ${selected ? "bg-blue-50" : ""}`}
    >
      <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
        <input type="checkbox" checked={selected} onChange={onToggle} className="h-4 w-4 rounded flex-shrink-0" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold text-sm">{user.username}</span>
            <span className="text-gray-400 font-mono text-sm">/ {user.password}</span>
          </div>
          <div className="text-xs text-gray-400 mt-0.5 flex flex-wrap gap-2">
            <span>{user.profile}</span>
            {user.comment && (
              <>
                <span>·</span>
                <span className="font-mono bg-gray-100 px-1 rounded">{user.comment}</span>
              </>
            )}
            {user.limitUptime && (
              <>
                <span>·</span>
                <span>{user.limitUptime}</span>
              </>
            )}
            {user.macAddress && (
              <>
                <span>·</span>
                <span className="font-mono">{user.macAddress}</span>
              </>
            )}
            {user.disabled && (
              <>
                <span>·</span>
                <span className="text-orange-400">désactivé</span>
              </>
            )}
            {localVoucher?.price && (
              <>
                <span>·</span>
                <span>{localVoucher.price}</span>
              </>
            )}
            {localVoucher?.createdAt && (
              <>
                <span>·</span>
                <span>
                  {formatDistanceToNow(new Date(localVoucher.createdAt), {
                    addSuffix: true,
                    locale: fr,
                  })}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0 ml-2">
        {isPrinted ? (
          <Badge variant="outline" className="text-green-600 border-green-200 text-xs">
            Imprimé
          </Badge>
        ) : localVoucher ? (
          <Badge variant="outline" className="text-orange-500 border-orange-200 text-xs">
            En attente
          </Badge>
        ) : (
          <Badge variant="outline" className="text-gray-400 border-gray-200 text-xs">
            MikroTik
          </Badge>
        )}
        {!isPrinted && localVoucher && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onMarkPrinted}
            title="Marquer comme imprimé"
            className="h-7 w-7 p-0"
          >
            <Printer className="h-3.5 w-3.5 text-gray-400" />
          </Button>
        )}
        {localVoucher && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onDeleteLocal}
            className="h-7 w-7 p-0"
            title="Supprimer l'entrée locale"
          >
            <span className="text-red-300 text-xs">✕</span>
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── VoucherPrintCard ─────────────────────────────────────────────────────────

function VoucherPrintCard({
  user,
  localVoucher,
  hotspotName,
  dnsName,
  num,
}: {
  user: HotspotUser;
  localVoucher?: Voucher;
  hotspotName: string;
  dnsName: string;
  num: number;
}) {
  const price = localVoucher?.price ?? null;
  const validity = localVoucher?.validity ?? null;
  const color = getPriceColor(price);

  const lv = localVoucher;
  const isVoucherMode =
    (lv?.username ?? user.username) === (lv?.password ?? user.password);

  const validityStr = formatValidityLabel(validity);
  const uptimeStr = formatUptimeLabel(user.limitUptime);
  const qrData = isVoucherMode
    ? user.username
    : `User:${user.username} Pass:${user.password}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=60x60&data=${encodeURIComponent(qrData)}&margin=2`;

  // ── Template rendering — toujours via le modèle HTML (défaut ou personnalisé) ──
  const storedTpl = getStoredTemplate();

  // Compute codeblock — equivalent de PHP $usermode == "vc" / "up"
  const codeblock = isVoucherMode
    ? `<div style="padding:0px;border-bottom:1px solid;text-align:center;font-weight:bold;font-size:9px;color:#444;">Code Ticket</div>` +
      `<div style="padding:0px;border-bottom:1px solid;text-align:center;font-weight:bold;font-size:12px;color:${color};">${user.username}</div>`
    : `<div style="padding:0px;border-bottom:1px solid;text-align:center;font-weight:bold;font-size:10px;color:#444;">Compte Utilisateur</div>` +
      `<div style="padding:0px;border-bottom:1px solid;text-align:center;font-weight:bold;font-size:12px;color:${color};">User: ${user.username}<br>Pass: ${user.password}</div>`;

  const vars: Record<string, string> = {
    hotspotname: hotspotName,
    dnsname: dnsName,
    username: user.username,
    password: user.password,
    price: String(price ?? ""),
    currency: "FCFA",
    validity: validityStr,
    timelimit: uptimeStr,
    datalimit: user.limitBytesTotal ?? "",
    num: String(num),
    profile: user.profile,
    color,
    codeblock,
    qrcode: qrUrl,
  };

  return <div dangerouslySetInnerHTML={{ __html: applyVars(storedTpl, vars) }} style={{ display: "inline-block", verticalAlign: "top" }} />;
}
