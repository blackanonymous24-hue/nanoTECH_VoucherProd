import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useListRouterUsers,
  useListRouterProfiles,
} from "@workspace/api-client-react";
import type { HotspotUser } from "@workspace/api-client-react";
import { useRouterContext } from "@/contexts/RouterContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  Loader2,
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
  Power,
  Check,
  ChevronsUpDown,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/use-debounce";
import { getStoredPHP } from "@/pages/TicketTemplate";
import { printTickets } from "@/lib/print";

type LotSummary = { name: string; count: number; profile: string | null; preview: HotspotUser[] };

const PAGE_SIZE = 100;
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

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

  const [view, setView] = useState<"list" | "lots">("list");
  const [search, setSearch] = useState("");
  const [filterProfile, setFilterProfile] = useState<string>("all");
  const [filterComment, setFilterComment] = useState<string>("all");
  const [isPrinting, setIsPrinting] = useState(false);
  const [page, setPage] = useState(0);
  const [selectedUsernames, setSelectedUsernames] = useState<Set<string>>(new Set());
  const [deletingLot, setDeletingLot] = useState<string | null>(null);
  const [isDeletingLot, setIsDeletingLot] = useState(false);
  const [isDisabling, setIsDisabling] = useState(false);
  const [confirmDeleteSelected, setConfirmDeleteSelected] = useState(false);
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);
  const [isSelectingAll, setIsSelectingAll] = useState(false);
  const [isTogglingSelected, setIsTogglingSelected] = useState(false);
  const [confirmToggleSelected, setConfirmToggleSelected] = useState<boolean | null>(null);
  const [profilePopoverOpen, setProfilePopoverOpen] = useState(false);
  const [commentPopoverOpen, setCommentPopoverOpen] = useState(false);

  const debouncedSearch = useDebounce(search, 400);

  const activeRouterId = selectedRouterId ?? null;
  const activeRouter = routers.find((r) => r.id === activeRouterId);

  // ── Lots query — lightweight, always active (tiny payload from server cache) ──
  const {
    data: lotsData,
    isLoading: lotsLoading,
    refetch: refetchLots,
  } = useQuery({
    queryKey: ["router-lots", activeRouterId],
    queryFn: async ({ signal }) => {
      const r = await fetch(`${BASE}/api/routers/${activeRouterId}/lots`, { signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<{ lots: LotSummary[]; total: number }>;
    },
    enabled: !!activeRouterId,
    staleTime: 120_000,
  });

  const lots: LotSummary[] = lotsData?.lots ?? [];
  const totalUsers = lotsData?.total ?? 0;
  // For the filter dropdown: derive from lots (server already sorted)
  // When a profile is selected, only show lots belonging to that profile
  const lotsForCommentFilter = filterProfile === "all"
    ? lots
    : lots.filter((l) => l.profile === filterProfile);
  const uniqueComments = lotsForCommentFilter.map((l) => ({ name: l.name, count: l.count }));

  // ── Users query — list view only, server-side filters, limit 2000 ─────────────
  const {
    data: allUsersData,
    isLoading: usersLoading,
    isFetching,
    refetch: refetchUsers,
    error,
  } = useListRouterUsers(
    activeRouterId ?? 0,
    {
      search: debouncedSearch || undefined,
      profile: filterProfile !== "all" ? filterProfile : undefined,
      comment: filterComment !== "all" ? filterComment : undefined,
      limit: 2000,
    },
    {
      query: {
        enabled: !!activeRouterId && view === "list",
        staleTime: 120_000,
      },
    },
  );

  const isLoading = view === "lots" ? lotsLoading : usersLoading;
  const refetch = () => { void refetchLots(); void refetchUsers(); };

  // Filtered list = what the server returned (already filtered server-side)
  const filtered = allUsersData?.users ?? [];
  const filteredTotal = allUsersData?.total ?? filtered.length;

  // ── Local pagination (on the 2000 loaded items) ───────────────────────────────
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageUsers = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const { data: profilesList = [] } = useListRouterProfiles(activeRouterId ?? 0, {
    query: { enabled: !!activeRouterId, staleTime: 120_000 },
  });

  // Keep MikroTik insertion order (= creation order), same as Mikhmon
  const sortedProfiles = profilesList;

  // ── Lot disable/enable via vouchers/lot-disable ───────────────────────────────
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

  // ── Select ALL users of the current profile/lot filter (no page limit) ───────
  const handleSelectAllProfile = async () => {
    if (!activeRouterId || filterProfile === "all") return;
    setIsSelectingAll(true);
    try {
      const params = new URLSearchParams();
      params.set("profile", filterProfile);
      if (filterComment !== "all") params.set("comment", filterComment);
      if (search) params.set("search", search);
      params.set("limit", "999999");
      const res = await fetch(`${BASE}/api/routers/${activeRouterId}/users?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { users: HotspotUser[] };
      setSelectedUsernames(new Set(data.users.map((u) => u.username)));
    } catch {
      toast({ title: "Erreur chargement", variant: "destructive" });
    } finally {
      setIsSelectingAll(false);
    }
  };

  // ── Toggle (enable/disable) selected usernames ───────────────────────────────
  const handleToggleSelected = async (enable: boolean) => {
    if (!activeRouterId || selectedUsernames.size === 0) return;
    setIsTogglingSelected(true);
    try {
      const res = await fetch(`${BASE}/api/vouchers/users-toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routerId: activeRouterId, usernames: [...selectedUsernames], enable }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { done: number };
      toast({
        title: enable
          ? `${data.done} voucher(s) réactivé(s)`
          : `${data.done} voucher(s) désactivé(s)`,
      });
      setSelectedUsernames(new Set());
      setConfirmToggleSelected(null);
      refetch();
    } catch (err) {
      toast({ title: "Erreur", description: String(err), variant: "destructive" });
    } finally {
      setIsTogglingSelected(false);
    }
  };

  // ── Delete selected usernames ────────────────────────────────────────────────
  const handleDeleteSelected = async () => {
    if (!activeRouterId || selectedUsernames.size === 0) return;
    setIsDeletingSelected(true);
    try {
      const res = await fetch(`${BASE}/api/routers/${activeRouterId}/users`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usernames: [...selectedUsernames] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { deleted: number };
      toast({
        title: `${data.deleted} voucher(s) supprimé(s)`,
        description: `Profil : ${filterProfile}`,
      });
      setSelectedUsernames(new Set());
      setConfirmDeleteSelected(false);
      refetch();
    } catch (err) {
      toast({ title: "Erreur suppression", description: String(err), variant: "destructive" });
    } finally {
      setIsDeletingSelected(false);
    }
  };

  // ── Lot delete — removes users from MikroTik ────────────────────────────────
  const handleDeleteLot = async (lotName: string) => {
    if (!activeRouterId) return;
    setIsDeletingLot(true);
    try {
      const res = await fetch(
        `${BASE}/api/routers/${activeRouterId}/users?comment=${encodeURIComponent(lotName)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { deleted: number };
      toast({
        title: `Lot « ${lotName} » supprimé`,
        description: `${data.deleted} utilisateur(s) supprimé(s) de MikroTik`,
      });
      refetch();
      setDeletingLot(null);
      if (filterComment === lotName) setFilterComment("all");
    } catch (err) {
      toast({ title: "Erreur suppression", description: String(err), variant: "destructive" });
    } finally {
      setIsDeletingLot(false);
    }
  };

  // ── Print ────────────────────────────────────────────────────────────────────
  const handlePrintVouchers = async () => {
    const php = getStoredPHP();
    if (!php) {
      toast({
        title: "Aucun modèle de ticket configuré",
        description: "Allez dans Modèle de ticket pour charger votre template PHP.",
        variant: "destructive",
      });
      return;
    }
    const usersForPrint = selectedUsernames.size > 0
      ? filtered.filter((u) => selectedUsernames.has(u.username))
      : filtered;
    if (usersForPrint.length === 0) {
      toast({ title: "Aucun voucher à imprimer", description: "Sélectionnez un lot ou des vouchers d'abord.", variant: "destructive" });
      return;
    }
    const vouchers = usersForPrint.map((user, idx) => {
      const profile = profilesList.find((p) => p.name === user.profile);
      return {
        hotspotname: (activeRouter as any)?.hotspotName || (activeRouter?.name ?? ""),
        dnsname: (activeRouter as any)?.contact ?? "",
        username: user.username,
        password: user.password,
        price: profile?.price ?? "",
        currency: "FCFA",
        validity: profile?.validity ?? "",
        timelimit: user.limitUptime ?? "",
        datalimit: user.limitBytesTotal ?? "",
        num: idx + 1,
      };
    });
    setIsPrinting(true);
    try {
      const resp = await fetch(`${BASE}/api/render-tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ php, vouchers }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      const toSlug = (s: string) => s.trim().replace(/\s+/g, "-");
      const toFileValidity = (v: string) => {
        const s = v.trim();
        const mk = s.match(/^(\d+)(h|d|m|w)$/i);
        if (mk) {
          const map: Record<string, string> = { h: "Heure", d: "Jour", m: "Minute", w: "Semaine" };
          return mk[1] + (map[mk[2].toLowerCase()] ?? mk[2].toUpperCase());
        }
        return s.replace(/[\s-]+/g, "");
      };
      const firstUser = usersForPrint[0];
      const printProfile = firstUser?.profile ?? "";
      const rawValidity = profilesList.find((p) => p.name === printProfile)?.validity ?? "";
      const compactValidity = toFileValidity(rawValidity);
      const printComment = firstUser?.comment ?? "";
      const hotspotName = (activeRouter as any)?.hotspotName || activeRouter?.name || "";
      const profileSlug = printProfile.trim().split(/\s+/)[0] ?? printProfile;
      const printParts = ["Voucher", toSlug(hotspotName), compactValidity, printComment, profileSlug].filter(Boolean);
      printTickets(data.html as string[], printParts.join("-"));
    } catch (err: unknown) {
      toast({ title: "Erreur impression PHP", description: String(err), variant: "destructive" });
    } finally {
      setIsPrinting(false);
    }
  };

  // ── Export .txt / .csv — lazy-fetch users for the lot on demand ─────────────
  const fetchLotUsers = async (lot: LotSummary): Promise<HotspotUser[]> => {
    const url = `${BASE}/api/routers/${activeRouterId}/users?comment=${encodeURIComponent(lot.name)}&limit=${lot.count + 100}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json() as { users: HotspotUser[] };
    return data.users;
  };

  const handleExportTxt = async (lot: LotSummary) => {
    try {
      const users = await fetchLotUsers(lot);
      const lines = users.map((u) => `${u.username} / ${u.password}`).join("\n");
      downloadFile(lines, `${lot.name}.txt`, "text/plain;charset=utf-8");
    } catch {
      toast({ title: "Erreur export", variant: "destructive" });
    }
  };

  const handleExportCsv = async (lot: LotSummary) => {
    try {
      const users = await fetchLotUsers(lot);
      const header = "username,password,profil,lot,uptime,data";
      const rows = users.map((u) =>
        [u.username, u.password, u.profile, u.comment ?? "", u.limitUptime ?? "", u.limitBytesTotal ?? ""]
          .map((s) => `"${String(s).replace(/"/g, '""')}"`)
          .join(","),
      );
      downloadFile([header, ...rows].join("\n"), `${lot.name}.csv`, "text/csv;charset=utf-8");
    } catch {
      toast({ title: "Erreur export", variant: "destructive" });
    }
  };

  // ── Selection helpers ────────────────────────────────────────────────────────
  const toggleSelect = (username: string) => {
    setSelectedUsernames((prev) => {
      const next = new Set(prev);
      if (next.has(username)) next.delete(username);
      else next.add(username);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedUsernames.size === pageUsers.length) {
      setSelectedUsernames(new Set());
    } else {
      setSelectedUsernames(new Set(pageUsers.map((u) => u.username)));
    }
  };

  const handleSearchChange = (v: string) => {
    setSearch(v);
    setPage(0);
  };

  const handleProfileChange = (v: string) => {
    setFilterProfile(v);
    setFilterComment("all"); // reset lot filter when profile changes
    setPage(0);
  };

  const handleCommentChange = (v: string) => {
    setFilterComment(v);
    setPage(0);
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
              {error ? (
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
              <><Card className="mb-4">
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
                          <span className="truncate whitespace-nowrap">
                            {filterProfile === "all" ? "Tous les forfaits" : filterProfile}
                          </span>
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto min-w-[10rem] max-w-xs p-0" align="start">
                        <div className="overflow-y-auto max-h-60 py-1">
                          {sortedProfiles.length === 0 && (
                            <p className="px-3 py-2 text-xs text-gray-400">Aucun forfait.</p>
                          )}
                          {[{ name: "all" as const }, ...sortedProfiles].map((p) => (
                            <button
                              key={p.name}
                              onClick={() => { handleProfileChange(p.name); setProfilePopoverOpen(false); }}
                              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-gray-100 transition-colors whitespace-nowrap"
                            >
                              <Check className={`h-3.5 w-3.5 flex-shrink-0 ${(p.name === "all" ? filterProfile === "all" : filterProfile === p.name) ? "opacity-100 text-blue-600" : "opacity-0"}`} />
                              {p.name === "all" ? "Tous les forfaits" : p.name}
                            </button>
                          ))}
                        </div>
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
                        <div className="overflow-y-auto max-h-72 py-1">
                          {uniqueComments.length === 0 && (
                            <p className="px-3 py-2 text-sm text-gray-400">Aucun lot.</p>
                          )}
                          <button
                            onClick={() => { handleCommentChange("all"); setCommentPopoverOpen(false); }}
                            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-gray-100 transition-colors"
                          >
                            <Check className={`h-4 w-4 flex-shrink-0 ${filterComment === "all" ? "opacity-100 text-blue-600" : "opacity-0"}`} />
                            Tous
                          </button>
                          {uniqueComments.map(({ name, count }) => (
                            <button
                              key={name}
                              onClick={() => { handleCommentChange(name); setCommentPopoverOpen(false); }}
                              className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-gray-100 transition-colors"
                            >
                              <Check className={`h-4 w-4 flex-shrink-0 ${filterComment === name ? "opacity-100 text-blue-600" : "opacity-0"}`} />
                              <span className="font-mono text-xs whitespace-nowrap flex-1">{name}</span>
                              <span className="text-xs text-green-600 ml-2 flex-shrink-0">({count})</span>
                            </button>
                          ))}
                        </div>
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
                    &nbsp;—&nbsp;{filteredTotal.toLocaleString("fr")} affiché(s)
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
                      disabled={isPrinting}
                      className="gap-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-50"
                    >
                      {isPrinting
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Printer className="h-3.5 w-3.5" />}
                      {isPrinting ? "Impression en cours..." : "Imprimer"}
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

              {/* Selection banner — shown when at least one user is ticked */}
              {(filterProfile !== "all" || selectedUsernames.size > 0) && (
                <div className="flex items-center gap-3 mb-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5 flex-wrap">
                  {/* "Select all of profile" shortcut — fetches ALL, not just loaded page */}
                  {filterProfile !== "all" && filteredTotal > 0 && (
                    selectedUsernames.size > 0 ? (
                      <button
                        type="button"
                        onClick={() => setSelectedUsernames(new Set())}
                        className="text-xs text-blue-500 hover:text-blue-700 underline underline-offset-2 transition-colors"
                      >
                        Désélectionner tout
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleSelectAllProfile}
                        disabled={isSelectingAll}
                        className="text-xs text-blue-600 hover:text-blue-800 underline underline-offset-2 transition-colors disabled:opacity-50"
                      >
                        {isSelectingAll
                          ? "Chargement..."
                          : `Sélectionner tout (${filteredTotal.toLocaleString("fr")})`}
                      </button>
                    )
                  )}

                  {selectedUsernames.size > 0 && (
                    <>
                      <span className="text-sm text-blue-700 font-medium">
                        {selectedUsernames.size} sélectionné(s)
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handlePrintVouchers}
                        disabled={isPrinting}
                        className="gap-1.5"
                      >
                        {isPrinting
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Printer className="h-3.5 w-3.5" />}
                        {isPrinting ? "Impression en cours..." : "Imprimer"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmToggleSelected(false)}
                        disabled={isTogglingSelected}
                        className="gap-1.5 text-orange-600 hover:text-orange-800 hover:bg-orange-50"
                      >
                        <PowerOff className="h-3.5 w-3.5" />
                        Désactiver
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmToggleSelected(true)}
                        disabled={isTogglingSelected}
                        className="gap-1.5 text-green-600 hover:text-green-800 hover:bg-green-50"
                      >
                        <Power className="h-3.5 w-3.5" />
                        Activer
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmDeleteSelected(true)}
                        className="gap-1.5 text-red-500 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Supprimer ({selectedUsernames.size})
                      </Button>
                    </>
                  )}
                </div>
              )}

              {/* Confirmation dialog — activate/deactivate selected */}
              <AlertDialog open={confirmToggleSelected !== null} onOpenChange={(open) => { if (!open) setConfirmToggleSelected(null); }}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {confirmToggleSelected ? "Activer" : "Désactiver"} {selectedUsernames.size} voucher(s) ?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {confirmToggleSelected
                        ? `${selectedUsernames.size} voucher(s) seront réactivés sur MikroTik.`
                        : `${selectedUsernames.size} voucher(s) seront désactivés sur MikroTik. Les sessions actives seront coupées.`}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Annuler</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => confirmToggleSelected !== null && void handleToggleSelected(confirmToggleSelected)}
                      disabled={isTogglingSelected}
                      className={confirmToggleSelected ? "bg-green-600 hover:bg-green-700" : "bg-orange-600 hover:bg-orange-700"}
                    >
                      {isTogglingSelected ? "En cours..." : confirmToggleSelected ? "Activer" : "Désactiver"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              {/* Confirmation dialog — delete selected */}
              <AlertDialog open={confirmDeleteSelected} onOpenChange={setConfirmDeleteSelected}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Supprimer {selectedUsernames.size} voucher(s) ?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Cette action supprimera définitivement {selectedUsernames.size} utilisateur(s)
                      du profil <strong>{filterProfile}</strong> sur MikroTik.
                      Cette opération est irréversible.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Annuler</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDeleteSelected}
                      disabled={isDeletingSelected}
                      className="bg-red-600 hover:bg-red-700"
                    >
                      {isDeletingSelected ? "Suppression..." : "Supprimer définitivement"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <Card>
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={
                        selectedUsernames.size === pageUsers.length && pageUsers.length > 0
                      }
                      onChange={selectAll}
                      className="h-4 w-4 rounded"
                    />
                    <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">
                      Voucher
                    </span>
                  </div>
                  <span className="text-xs text-gray-400">
                    {filteredTotal !== totalUsers
                      ? `${filteredTotal.toLocaleString("fr")} filtrés / ${totalUsers.toLocaleString("fr")} total`
                      : `${totalUsers.toLocaleString("fr")} total`}
                  </span>
                </div>
                <CardContent className="p-0">
                  {isLoading ? (
                    <div className="py-12 text-center text-gray-400 text-sm">
                      <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-3 text-gray-300" />
                      Chargement depuis le routeur...
                    </div>
                  ) : filteredTotal === 0 ? (
                    <div className="py-8 text-center text-gray-400 text-sm">
                      Aucun voucher trouvé.
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-100 print:block" id="voucher-print-area">
                      {pageUsers.map((user) => (
                        <UserRow
                          key={user.username}
                          user={user}
                          selected={selectedUsernames.has(user.username)}
                          onToggle={() => toggleSelect(user.username)}
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
                      Page {page + 1} / {totalPages} ({filteredTotal.toLocaleString("fr")} résultats)
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
                            title="Supprimer ce lot de MikroTik"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>

                      {/* Preview: first 4 vouchers */}
                      <div className="border-t border-gray-100 bg-gray-50 px-5 py-2 flex flex-wrap gap-3">
                        {lot.preview.map((u) => (
                          <span key={u.username} className="font-mono text-xs text-gray-500">
                            {u.username} / {u.password}
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
              définitivement supprimés de MikroTik. Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deletingLot && handleDeleteLot(deletingLot)}
              disabled={isDeletingLot}
            >
              {isDeletingLot ? "Suppression..." : "Supprimer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Hidden download icon for accessibility */}
      <Download className="hidden" />

      {/* ── Print section — hidden on screen, visible on print ── */}
      <div id="voucher-print-section" style={{ display: "none" }} />
    </div>
  );
}

function UserRow({
  user,
  selected,
  onToggle,
}: {
  user: HotspotUser;
  selected: boolean;
  onToggle: () => void;
}) {
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
          </div>
        </div>
      </div>
    </div>
  );
}
