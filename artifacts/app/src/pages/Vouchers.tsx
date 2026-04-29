import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useListRouterUsers,
  useListRouterProfiles,
} from "@workspace/api-client-react";
import type { HotspotUser, HotspotUserListResponse } from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";
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
  Pencil,
  RotateCcw,
  MoreHorizontal,
  UserPlus,
  Eye,
  EyeOff,
  X,
  Save,
  BookOpen,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/use-debounce";
import { getStoredPHP } from "@/pages/TicketTemplate";
import { printTickets } from "@/lib/print";
import { foldText } from "@/lib/text";

type LotSummary = { name: string; count: number; profile: string | null; preview: HotspotUser[] };
type VendorAliasRow = { name: string; commentSuffix?: string | null; commentSuffix2?: string | null };

const PAGE_SIZE = 100;
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// Module-level cache — persists across component unmount/remount (tab navigation).
// Provides instant display on re-visit without waiting for React Query to refetch.
const _vouchersCache: Record<number, {
  lots?: { lots: LotSummary[]; total: number }; lotsTs?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  users?: any; usersTs?: number;
}> = {};

// ── Optimistic update helpers ──────────────────────────────────────────────────
// Instantly flip the `disabled` field for a set of usernames in ALL React Query
// caches for this router, returning a snapshot for rollback on error.
function optimisticSetDisabled(routerId: number, usernames: Set<string>, disabled: boolean) {
  const snapshot = queryClient.getQueriesData<HotspotUserListResponse>({
    queryKey: [`/routers/${routerId}/users`],
    exact: false,
  });
  queryClient.setQueriesData<HotspotUserListResponse>(
    { queryKey: [`/routers/${routerId}/users`], exact: false },
    (old) => {
      if (!old) return old;
      return { ...old, users: old.users.map((u) => usernames.has(u.username) ? { ...u, disabled } : u) };
    },
  );
  return snapshot;
}

// Extract vendor name from lot name: "vc-991-04.08.26-3JEZECHIEL" → "EZECHIEL"
// Format after date: -{digits}{profile_letter(s)}{VENDOR_NAME}
// Profile codes: 1J, 3J, 1S, 1M, 2S, 1H, 2H, 5H, etc.
function extractVendorFromLot(name: string): string | null {
  // Format: "vc-{qty}-{DD.MM.YY}-{count}{profileCode}{VENDORNAME}"
  // We strip the leading profile code so all lots of the same vendor
  // (e.g. 1J..., 1S..., 1M...) collapse under one vendor filter value.
  const m = name.match(/-\d{2}\.\d{2}\.\d{2}-(\d+)([A-Za-z0-9_-]+)$/);
  if (!m) return null;
  const tail = (m[2] ?? "").toUpperCase();
  if (!tail) return null;

  const profilePrefixes = [
    "30J", "15J", "12H", "10H",
    "7J", "5H", "4H", "3H", "2H", "1H",
    "3J", "2J", "1J",
    "3S", "2S", "1S",
    "3M", "2M", "1M",
    "J", "S", "M", "H",
  ];
  const prefix = profilePrefixes.find((p) => tail.startsWith(p));
  const rawVendor = (prefix ? tail.slice(prefix.length) : tail.slice(1)).replace(/^[-_]+/, "").trim();
  return rawVendor.length >= 2 ? rawVendor : null;
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
  const [vendorPopoverOpen, setVendorPopoverOpen] = useState(false);
  const [statusPopoverOpen, setStatusPopoverOpen] = useState(false);
  const [filterVendor, setFilterVendor] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "expired" | "disabled" | "active">("all");
  const [editingUser, setEditingUser] = useState<HotspotUser | null>(null);
  const [editUsername, setEditUsername] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editProfile, setEditProfile] = useState("");
  const [editBypassMac, setEditBypassMac] = useState("");
  const [editBypassComment, setEditBypassComment] = useState("");
  const [linkBypass, setLinkBypass] = useState(false);
  const [editShowPassword, setEditShowPassword] = useState(false);
  const [isSavingRename, setIsSavingRename] = useState(false);
  const [confirmResetUser, setConfirmResetUser] = useState<HotspotUser | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [lotsSearch, setLotsSearch] = useState("");
  const [lotsFilterProfile, setLotsFilterProfile] = useState<string>("all");
  const [lotsFilterVendor, setLotsFilterVendor] = useState<string>("all");
  const [lotsProfilePopoverOpen, setLotsProfilePopoverOpen] = useState(false);
  const [lotsVendorPopoverOpen, setLotsVendorPopoverOpen] = useState(false);

  // ── Add User dialog (Mikhmon-style) ─────────────────────────────────────────
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [addServer, setAddServer] = useState("all");
  const [addName, setAddName] = useState("");
  const [addPassword, setAddPassword] = useState("");
  const [addShowPassword, setAddShowPassword] = useState(false);
  const [addProfile, setAddProfile] = useState("");
  const [addTimeLimit, setAddTimeLimit] = useState("");
  const [addDataLimit, setAddDataLimit] = useState("");
  const [addDataUnit, setAddDataUnit] = useState<"MB" | "GB">("MB");
  const [addComment, setAddComment] = useState("");
  const [addProfilePopoverOpen, setAddProfilePopoverOpen] = useState(false);
  const [addServerPopoverOpen, setAddServerPopoverOpen] = useState(false);
  const [addUnitPopoverOpen, setAddUnitPopoverOpen] = useState(false);
  const [isSavingUser, setIsSavingUser] = useState(false);

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
      const result = await r.json() as { lots: LotSummary[]; total: number };
      if (activeRouterId) {
        _vouchersCache[activeRouterId] = { ..._vouchersCache[activeRouterId], lots: result, lotsTs: Date.now() };
      }
      return result;
    },
    enabled: !!activeRouterId,
    // staleTime:0 → background-refetch déclenché à chaque montage ; comme /lots utilise
    // getCachedUsers (MikroTik, TTL 5 min serveur), un lot supprimé disparaît dès que le
    // cache serveur expire, ou immédiatement après invalidateUserCache (delete/disable).
    staleTime: 0,
    gcTime: 30 * 60_000,
    initialData: activeRouterId != null ? _vouchersCache[activeRouterId]?.lots : undefined,
    initialDataUpdatedAt: activeRouterId != null ? _vouchersCache[activeRouterId]?.lotsTs : undefined,
  });

  const lots: LotSummary[] = lotsData?.lots ?? [];
  const totalUsers = lotsData?.total ?? 0;
  const { data: vendorsAlias = [] } = useQuery<VendorAliasRow[]>({
    queryKey: ["vendors-aliases", activeRouterId],
    enabled: !!activeRouterId,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/vendors?routerId=${activeRouterId}`);
      if (!res.ok) return [];
      return await res.json() as VendorAliasRow[];
    },
    staleTime: 60_000,
  });
  const vendorAliasMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of vendorsAlias) {
      const vendorName = String(v.name ?? "").trim();
      if (!vendorName) continue;
      for (const token of [vendorName, v.commentSuffix ?? "", v.commentSuffix2 ?? ""]) {
        const key = foldText(String(token).trim());
        if (key) map.set(key, vendorName);
      }
    }
    return map;
  }, [vendorsAlias]);
  const canonicalVendorFromLot = (lotNameOrComment: string): string | null => {
    const raw = extractVendorFromLot(lotNameOrComment);
    if (!raw) return null;
    return vendorAliasMap.get(foldText(raw)) ?? raw;
  };
  // For the filter dropdown: derive from lots (server already sorted)
  // Apply both profile and vendor filters so lot dropdown is narrowed
  const lotsForCommentFilter = lots
    .filter((l) => filterProfile === "all" || l.profile === filterProfile)
    .filter((l) => filterVendor === "all" || canonicalVendorFromLot(l.name) === filterVendor);
  const uniqueComments = lotsForCommentFilter.map((l) => ({ name: l.name, count: l.count }));

  // Unique vendor list for the list-view vendor filter (reuses same extraction)
  const uniqueVendors = useMemo(() => {
    const set = new Set<string>();
    for (const l of lots) {
      const v = canonicalVendorFromLot(l.name);
      if (v) set.add(v);
    }
    return [...set].sort();
  }, [lots, vendorAliasMap]);

  // ── Lots view: local search + profile + vendor filters ───────────────────────
  const debouncedLotsSearch = useDebounce(lotsSearch, 200);

  // Build unique vendor list from lot names (extracted via naming convention)
  const lotsVendors = useMemo(() => {
    const set = new Set<string>();
    for (const l of lots) {
      const v = canonicalVendorFromLot(l.name);
      if (v) set.add(v);
    }
    return [...set].sort();
  }, [lots, vendorAliasMap]);

  const filteredLots = useMemo(() => {
    let result = lots;
    if (lotsFilterProfile !== "all") result = result.filter((l) => l.profile === lotsFilterProfile);
    if (lotsFilterVendor !== "all")
      result = result.filter((l) => canonicalVendorFromLot(l.name) === lotsFilterVendor);
    if (debouncedLotsSearch.trim()) {
      const q = foldText(debouncedLotsSearch).trim();
      result = result.filter(
        (l) =>
          foldText(l.name).includes(q) ||
          foldText(l.profile ?? "").includes(q) ||
          foldText(canonicalVendorFromLot(l.name) ?? "").includes(q) ||
          l.preview.some((u) => foldText(u.username).includes(q)),
      );
    }
    return result;
  }, [lots, lotsFilterProfile, lotsFilterVendor, debouncedLotsSearch, vendorAliasMap]);

  // ── Users query — list view only, server-side filters, limit 2000 ─────────────
  // For the default (unfiltered) case, use module-level cache so list shows instantly on re-visit.
  const isDefaultFilter = !debouncedSearch && filterProfile === "all" && filterComment === "all";
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
        // staleTime:0 → React Query déclenche TOUJOURS un background-refetch au montage,
        // même si initialData est présent. Un utilisateur supprimé de MikroTik disparaît
        // dès que le refetch revient (< 1s avec cache serveur), sans jamais rester visible.
        staleTime: 0,
        gcTime: 30 * 60_000,
        initialData: (isDefaultFilter && activeRouterId != null) ? _vouchersCache[activeRouterId]?.users : undefined,
        initialDataUpdatedAt: (isDefaultFilter && activeRouterId != null) ? _vouchersCache[activeRouterId]?.usersTs : undefined,
      },
    },
  );

  // Update module cache when unfiltered users data arrives
  useEffect(() => {
    if (isDefaultFilter && activeRouterId && allUsersData) {
      _vouchersCache[activeRouterId] = { ..._vouchersCache[activeRouterId], users: allUsersData, usersTs: Date.now() };
    }
  }, [allUsersData, activeRouterId, isDefaultFilter]);

  const isLoading = view === "lots" ? lotsLoading : usersLoading;
  const refetch = () => { void refetchLots(); void refetchUsers(); };

  const { data: profilesList = [] } = useListRouterProfiles(activeRouterId ?? 0, {
    query: { enabled: !!activeRouterId, staleTime: 120_000 },
  });
  const profileExpiryModeByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of profilesList as Array<Record<string, unknown>>) {
      const name = String(p.name ?? "").trim();
      if (!name) continue;
      const mode = String(p.expiredMode ?? p.expmode ?? "").trim().toLowerCase();
      if (mode) map.set(name, mode);
    }
    return map;
  }, [profilesList]);
  const userIsExpired = (u: HotspotUser): boolean => {
    const mode = profileExpiryModeByName.get(u.profile ?? "");
    if (mode) {
      if (mode === "none" || mode === "nothing" || mode === "0") return false;
      return isExpired(u.comment);
    }
    return !isUnlimitedProfile(u.profile) && isExpired(u.comment);
  };

  // Filtered list = what the server returned (already filtered server-side)
  const filtered = useMemo(() => {
    let base = allUsersData?.users ?? [];
    if (filterVendor !== "all") {
      base = base.filter((u) => canonicalVendorFromLot(u.comment ?? "") === filterVendor);
    }
    if (filterStatus === "all") return base;
    if (filterStatus === "disabled") return base.filter((u) => !!u.disabled);
    if (filterStatus === "active") return base.filter((u) => !u.disabled);
    return base.filter((u) => !u.disabled && userIsExpired(u));
  }, [allUsersData?.users, filterVendor, filterStatus, profileExpiryModeByName, vendorAliasMap]);
  const filteredTotal = filtered.length;

  // ── Local pagination (on the 2000 loaded items) ───────────────────────────────
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageUsers = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const { data: bypassBindings = [] } = useQuery({
    queryKey: ["router-ip-bindings", activeRouterId],
    enabled: !!activeRouterId && !!editingUser && linkBypass,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/routers/${activeRouterId}/ip-bindings`);
      if (!res.ok) return [] as Array<{ id: string; macAddress: string; comment: string; type: string }>;
      const data = await res.json() as { bindings?: Array<{ id: string; macAddress: string; comment: string; type: string }> };
      return (data.bindings ?? []).filter((b) => (b.type ?? "").toLowerCase() === "bypassed");
    },
    staleTime: 30_000,
  });

  // Keep MikroTik insertion order (= creation order), same as Mikhmon
  const sortedProfiles = profilesList;

  // ── Lot disable/enable via vouchers/lot-disable ───────────────────────────────
  const handleDisableLot = async (comment: string, enable: boolean) => {
    if (!activeRouterId) return;

    // Optimistic update — flip users matching this lot comment in the cache
    const usersInLot = new Set(
      (allUsersData?.users ?? []).filter((u) => u.comment === comment).map((u) => u.username),
    );
    const snapshot = usersInLot.size > 0
      ? optimisticSetDisabled(activeRouterId, usersInLot, !enable)
      : [];

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
      void refetchLots();
      void refetchUsers();
    } catch {
      for (const [key, val] of snapshot) queryClient.setQueryData(key, val);
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
    if (!activeRouterId || selectedUsernames.size === 0 || isTogglingSelected) return;
    const usernamesArr = [...selectedUsernames];
    const count = usernamesArr.length;

    // 1. Optimistic update — instant visual feedback
    const snapshot = optimisticSetDisabled(activeRouterId, selectedUsernames, !enable);

    // 2. Close dialog + clear selection + toast immediately (0ms delay)
    setConfirmToggleSelected(null);
    setSelectedUsernames(new Set());
    toast({ title: enable ? `${count} voucher(s) réactivé(s)` : `${count} voucher(s) désactivé(s)` });

    // 3. API call + silent background sync
    setIsTogglingSelected(true);
    try {
      const res = await fetch(`${BASE}/api/vouchers/users-toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routerId: activeRouterId, usernames: usernamesArr, enable }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      void refetchLots();
      void refetchUsers();
    } catch (err) {
      // Rollback optimistic update
      for (const [key, val] of snapshot) queryClient.setQueryData(key, val);
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
      let resp: Response;
      try {
        resp = await fetch(`${BASE}/api/render-tickets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ php, vouchers }),
        });
      } catch (netErr) {
        // Réseau coupé / serveur inaccessible
        // eslint-disable-next-line no-console
        console.error("[print] network error:", netErr);
        toast({
          title: "Connexion au serveur perdue",
          description: "Vérifiez votre connexion Internet puis réessayez.",
          variant: "destructive",
        });
        return;
      }

      // Lecture sécurisée — l'API peut renvoyer du HTML (504, 502…) au lieu de JSON
      const rawText = await resp.text();
      let data: { html?: string[]; error?: string } = {};
      try { data = rawText ? JSON.parse(rawText) : {}; } catch {
        // eslint-disable-next-line no-console
        console.error("[print] non-JSON response:", resp.status, rawText.slice(0, 300));
        toast({
          title: "Réponse serveur invalide",
          description: `HTTP ${resp.status} — réessayez dans quelques secondes.`,
          variant: "destructive",
        });
        return;
      }

      if (!resp.ok || data.error) {
        const msg = data.error ?? `HTTP ${resp.status}`;
        // eslint-disable-next-line no-console
        console.error("[print] server error:", msg);
        toast({
          title: "Erreur d'impression",
          description: msg.length > 220 ? msg.slice(0, 220) + "…" : msg,
          variant: "destructive",
        });
        return;
      }

      if (!Array.isArray(data.html) || data.html.length === 0) {
        toast({
          title: "Aucun ticket généré",
          description: "Le modèle PHP n'a rien retourné. Vérifiez votre template.",
          variant: "destructive",
        });
        return;
      }

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

      try {
        printTickets(data.html, printParts.join("-"));
      } catch (printErr) {
        // eslint-disable-next-line no-console
        console.error("[print] printTickets threw:", printErr);
        toast({
          title: "Impression bloquée",
          description: "Si une fenêtre popup a été bloquée, autorisez-la pour ce site puis réessayez.",
          variant: "destructive",
        });
      }
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

  // ── Rename (edit username) ────────────────────────────────────────────────
  const openEditUser = (user: HotspotUser) => {
    setEditingUser(user);
    setEditUsername(user.username);
    setEditPassword(user.password);
    setEditProfile(user.profile);
    setEditBypassMac(user.macAddress ?? "");
    setEditBypassComment("");
    setLinkBypass(!!user.macAddress);
    setEditShowPassword(false);
  };

  const handleRenameUser = async () => {
    if (!activeRouterId || !editingUser) return;
    const nextUsername = editUsername.trim();
    const nextPassword = editPassword.trim();
    const nextProfile = editProfile.trim();
    const nextBypassMac = editBypassMac.trim().toUpperCase();

    if (!nextUsername) {
      toast({ title: "Identifiant requis", variant: "destructive" });
      return;
    }
    if (!nextPassword) {
      toast({ title: "Mot de passe requis", variant: "destructive" });
      return;
    }
    if (!nextProfile) {
      toast({ title: "Profil requis", variant: "destructive" });
      return;
    }
    if (linkBypass && !nextBypassMac) {
      toast({ title: "MAC bypass requise", description: "Renseignez une adresse MAC pour lier le bypass.", variant: "destructive" });
      return;
    }

    const nothingChanged =
      nextUsername === editingUser.username &&
      nextPassword === editingUser.password &&
      nextProfile === editingUser.profile &&
      (!linkBypass || nextBypassMac === (editingUser.macAddress ?? ""));
    if (nothingChanged) { setEditingUser(null); return; }

    setIsSavingRename(true);
    try {
      const res = await fetch(
        `${BASE}/api/routers/${activeRouterId}/users/${encodeURIComponent(editingUser.username)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            newUsername: nextUsername,
            password: nextPassword,
            profile: nextProfile,
            linkBypass,
            bypassMacAddress: linkBypass ? nextBypassMac : undefined,
            bypassComment: linkBypass ? editBypassComment.trim() : undefined,
          }),
        },
      );
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      toast({ title: "Utilisateur modifié", description: `${editingUser.username} mis à jour.` });
      setEditingUser(null);
      await Promise.all([refetchUsers(), refetchLots()]);
    } catch (err) {
      toast({ title: "Erreur modification", description: String(err), variant: "destructive" });
    } finally {
      setIsSavingRename(false);
    }
  };

  const handleResetUser = async () => {
    if (!activeRouterId || !confirmResetUser || isResetting) return;
    const user = confirmResetUser;

    // 1. Close dialog + loading state
    setConfirmResetUser(null);
    setIsResetting(true);
    const resetToast = toast({
      title: "Réinitialisation… en cours",
      description: `${user.username} — traitement en cours`,
    });

    try {
      // 2. Reset on MikroTik
      const res = await fetch(
        `${BASE}/api/routers/${activeRouterId}/users/${encodeURIComponent(user.username)}/reset`,
        { method: "POST", headers: { "Content-Type": "application/json" } },
      );
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      await res.json();

      // 3. Rechargement immédiat — le serveur a déjà patché son cache
      //    in-memory (commentaire vidé, limites/quotas remis à zéro), donc
      //    le refetch revient instantanément sans round-trip MikroTik.
      await Promise.all([refetchUsers(), refetchLots()]);
      resetToast.update({
        id: resetToast.id,
        title: "Réinitialisation réussie",
        description: `${user.username} a été réinitialisé.`,
      });

    } catch (err) {
      resetToast.update({
        id: resetToast.id,
        title: "Erreur de réinitialisation",
        description: String(err),
        variant: "destructive",
      });
    } finally {
      setIsResetting(false);
    }
  };

  const handleSearchChange = (v: string) => {
    setSearch(v);
    setPage(0);
  };

  // ── Add User (Mikhmon-style single user creation) ──────────────────────────
  function resetAddUserForm() {
    setAddServer("all");
    setAddName("");
    setAddPassword("");
    setAddShowPassword(false);
    setAddProfile("");
    setAddTimeLimit("");
    setAddDataLimit("");
    setAddDataUnit("MB");
    setAddComment("");
  }

  function bytesFromInput(value: string, unit: "MB" | "GB"): string | undefined {
    const v = value.trim();
    if (!v) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    const mult = unit === "GB" ? 1024 * 1024 * 1024 : 1024 * 1024;
    return String(Math.round(n * mult));
  }

  // Validate Mikhmon's wdhm format: 30d, 12h, 4w3d, 1d12h30m...
  function isValidWdhm(s: string): boolean {
    if (!s.trim()) return true; // optional
    return /^(\d+w)?(\d+d)?(\d+h)?(\d+m)?(\d+s)?$/i.test(s.trim()) && /\d/.test(s);
  }

  async function handleSaveUser() {
    if (!activeRouterId) return;
    if (!addName.trim()) {
      toast({ title: "Nom requis", description: "Veuillez saisir un nom d'utilisateur.", variant: "destructive" });
      return;
    }
    if (!addPassword.trim()) {
      toast({ title: "Mot de passe requis", description: "Veuillez saisir un mot de passe.", variant: "destructive" });
      return;
    }
    if (!addProfile.trim()) {
      toast({ title: "Profil requis", description: "Veuillez choisir un profil.", variant: "destructive" });
      return;
    }
    if (!isValidWdhm(addTimeLimit)) {
      toast({
        title: "Time Limit invalide",
        description: "Format attendu: wdhm (ex: 30d, 12h, 4w3d).",
        variant: "destructive",
      });
      return;
    }

    setIsSavingUser(true);
    try {
      const body: Record<string, string> = {
        name: addName.trim(),
        password: addPassword.trim(),
        profile: addProfile.trim(),
      };
      if (addServer && addServer !== "all") body.server = addServer.trim();
      if (addTimeLimit.trim()) body.limitUptime = addTimeLimit.trim();
      const bytes = bytesFromInput(addDataLimit, addDataUnit);
      if (bytes) body.limitBytesTotal = bytes;
      if (addComment.trim()) body.comment = addComment.trim();

      const res = await fetch(`${BASE}/api/routers/${activeRouterId}/hotspot-users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `HTTP ${res.status}`);
      }
      toast({ title: "Utilisateur ajouté", description: `${addName.trim()} créé sur MikroTik.` });
      // Refresh data
      void refetchUsers();
      void refetchLots();
      queryClient.invalidateQueries({ queryKey: [`/routers/${activeRouterId}/users/count`] });
      resetAddUserForm();
      setAddUserOpen(false);
    } catch (e) {
      toast({
        title: "Échec de la création",
        description: e instanceof Error ? e.message : "Erreur inconnue",
        variant: "destructive",
      });
    } finally {
      setIsSavingUser(false);
    }
  }

  const handleProfileChange = (v: string) => {
    setFilterProfile(v);
    setFilterComment("all");
    setPage(0);
  };

  const handleCommentChange = (v: string) => {
    setFilterComment(v);
    setPage(0);
  };

  const handleVendorChange = (v: string) => {
    setFilterVendor(v);
    setFilterComment("all"); // reset lot when vendor changes
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
            <Button
              size="sm"
              onClick={() => { resetAddUserForm(); setAddUserOpen(true); }}
              className="gap-2 bg-cyan-500 hover:bg-cyan-600 text-white"
              title="Ajouter un utilisateur (Mikhmon-style)"
            >
              <UserPlus className="h-4 w-4" />
              <span className="hidden sm:inline">Add User</span>
            </Button>
            {view === "list" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={isFetching}
                className="gap-2"
                title="Actualiser"
              >
                <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
                <span className="hidden sm:inline">Actualiser</span>
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
                  <div className="flex items-center gap-3 whitespace-nowrap overflow-x-auto">
                    <div className="relative w-72 min-w-[18rem] flex-shrink-0">
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

                    {/* Combobox — Vendeur */}
                    <Popover open={vendorPopoverOpen} onOpenChange={setVendorPopoverOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={vendorPopoverOpen}
                          className={`w-44 justify-between font-normal ${filterVendor !== "all" ? "border-blue-400 text-blue-700 bg-blue-50" : ""}`}
                        >
                          <span className="truncate whitespace-nowrap">
                            {filterVendor === "all" ? "Tous les vendeurs" : filterVendor}
                          </span>
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto min-w-[11rem] max-w-xs p-0" align="start">
                        <div className="overflow-y-auto max-h-60 py-1">
                          <button
                            onClick={() => { handleVendorChange("all"); setVendorPopoverOpen(false); }}
                            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-gray-100 transition-colors whitespace-nowrap"
                          >
                            <Check className={`h-3.5 w-3.5 flex-shrink-0 ${filterVendor === "all" ? "opacity-100 text-blue-600" : "opacity-0"}`} />
                            Tous les vendeurs
                          </button>
                          {uniqueVendors.length === 0 ? (
                            <p className="px-3 py-2 text-xs text-gray-400 italic">Aucun vendeur identifié.</p>
                          ) : (
                            uniqueVendors.map((v) => (
                              <button
                                key={v}
                                onClick={() => { handleVendorChange(v); setVendorPopoverOpen(false); }}
                                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-gray-100 transition-colors whitespace-nowrap"
                              >
                                <Check className={`h-3.5 w-3.5 flex-shrink-0 ${filterVendor === v ? "opacity-100 text-blue-600" : "opacity-0"}`} />
                                {v}
                              </button>
                            ))
                          )}
                        </div>
                      </PopoverContent>
                    </Popover>

                    {/* Combobox — Statut */}
                    <Popover open={statusPopoverOpen} onOpenChange={setStatusPopoverOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={statusPopoverOpen}
                          className={`w-40 justify-between font-normal ${filterStatus !== "all" ? "border-blue-400 text-blue-700 bg-blue-50" : ""}`}
                        >
                          <span className="truncate whitespace-nowrap">
                            {filterStatus === "all"
                              ? "Tous statuts"
                              : filterStatus === "expired"
                                ? "Expirés"
                                : filterStatus === "disabled"
                                  ? "Désactivés"
                                  : "Activés"}
                          </span>
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto min-w-[10rem] max-w-xs p-0" align="start">
                        <div className="overflow-y-auto max-h-56 py-1">
                          {[
                            { id: "all", label: "Tous statuts" },
                            { id: "active", label: "Activés" },
                            { id: "disabled", label: "Désactivés" },
                            { id: "expired", label: "Expirés" },
                          ].map((s) => (
                            <button
                              key={s.id}
                              onClick={() => { setFilterStatus(s.id as typeof filterStatus); setStatusPopoverOpen(false); setPage(0); }}
                              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-gray-100 transition-colors whitespace-nowrap"
                            >
                              <Check className={`h-3.5 w-3.5 flex-shrink-0 ${filterStatus === s.id ? "opacity-100 text-blue-600" : "opacity-0"}`} />
                              {s.label}
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
                      <button
                        type="button"
                        onClick={() => setSelectedUsernames(new Set())}
                        className="text-xs text-blue-500 hover:text-blue-700 underline underline-offset-2 transition-colors"
                      >
                        Désélectionner tout
                      </button>
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
                      {selectedUsernames.size === 1 && (() => {
                        const username = [...selectedUsernames][0];
                        const selUser = filtered.find((u) => u.username === username) ?? ({ username } as HotspotUser);
                        return (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openEditUser(selUser)}
                              disabled={isSavingRename}
                              className="gap-1.5 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Modifier
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setConfirmResetUser(selUser)}
                              disabled={isResetting}
                              className="gap-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-50"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              Réinitialiser
                            </Button>
                          </>
                        );
                      })()}
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
                          isExpired={userIsExpired(user)}
                          selected={selectedUsernames.has(user.username)}
                          onToggle={() => toggleSelect(user.username)}
                          onEdit={() => openEditUser(user)}
                          onReset={() => setConfirmResetUser(user)}
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
              {/* Search bar + profile filter for lots */}
              {lots.length > 0 && (
                <Card className="mb-4">
                  <CardContent className="py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="relative flex-1 min-w-48">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                        <Input
                          className="pl-8"
                          placeholder="Rechercher un lot, un vendeur, un forfait..."
                          value={lotsSearch}
                          onChange={(e) => setLotsSearch(e.target.value)}
                        />
                      </div>
                      {/* Vendor filter — always visible */}
                      <Popover open={lotsVendorPopoverOpen} onOpenChange={setLotsVendorPopoverOpen}>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            role="combobox"
                            className={`w-40 justify-between text-sm font-normal ${lotsFilterVendor !== "all" ? "border-blue-400 text-blue-700 bg-blue-50" : ""}`}
                          >
                            <span className="truncate">
                              {lotsFilterVendor === "all" ? "Tous les vendeurs" : lotsFilterVendor}
                            </span>
                            <ChevronsUpDown className="ml-2 h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-48 p-1" align="start">
                          <div className="max-h-64 overflow-y-auto">
                            <button
                              className={`w-full text-left text-sm px-3 py-1.5 rounded hover:bg-gray-100 ${lotsFilterVendor === "all" ? "font-semibold text-blue-600" : ""}`}
                              onClick={() => { setLotsFilterVendor("all"); setLotsVendorPopoverOpen(false); }}
                            >
                              Tous les vendeurs
                            </button>
                            {lotsVendors.length === 0 ? (
                              <p className="text-xs text-gray-400 px-3 py-2 italic">Aucun vendeur identifié</p>
                            ) : (
                              lotsVendors.map((v) => (
                                <button
                                  key={v}
                                  className={`w-full text-left text-sm px-3 py-1.5 rounded hover:bg-gray-100 ${lotsFilterVendor === v ? "font-semibold text-blue-600" : ""}`}
                                  onClick={() => { setLotsFilterVendor(v); setLotsVendorPopoverOpen(false); }}
                                >
                                  {v}
                                </button>
                              ))
                            )}
                          </div>
                        </PopoverContent>
                      </Popover>

                      {/* Forfait filter */}
                      <Popover open={lotsProfilePopoverOpen} onOpenChange={setLotsProfilePopoverOpen}>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            role="combobox"
                            className={`w-44 justify-between text-sm font-normal ${lotsFilterProfile !== "all" ? "border-blue-400 text-blue-700 bg-blue-50" : ""}`}
                          >
                            <span className="truncate">
                              {lotsFilterProfile === "all" ? "Tous les forfaits" : lotsFilterProfile}
                            </span>
                            <ChevronsUpDown className="ml-2 h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-52 p-1" align="end">
                          <div className="max-h-56 overflow-y-auto">
                            <button
                              className={`w-full text-left text-sm px-3 py-1.5 rounded hover:bg-gray-100 ${lotsFilterProfile === "all" ? "font-semibold text-blue-600" : ""}`}
                              onClick={() => { setLotsFilterProfile("all"); setLotsProfilePopoverOpen(false); }}
                            >
                              Tous les forfaits
                            </button>
                            {[...new Set(lots.map((l) => l.profile).filter(Boolean) as string[])].sort().map((p) => (
                              <button
                                key={p}
                                className={`w-full text-left text-sm px-3 py-1.5 rounded hover:bg-gray-100 ${lotsFilterProfile === p ? "font-semibold text-blue-600" : ""}`}
                                onClick={() => { setLotsFilterProfile(p); setLotsProfilePopoverOpen(false); }}
                              >
                                {p}
                              </button>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>

                      {/* Reset */}
                      {(lotsSearch || lotsFilterProfile !== "all" || lotsFilterVendor !== "all") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => { setLotsSearch(""); setLotsFilterProfile("all"); setLotsFilterVendor("all"); }}
                          className="text-gray-400 hover:text-gray-600"
                        >
                          Réinitialiser
                        </Button>
                      )}

                      <span className="text-xs text-gray-400 ml-auto">
                        {filteredLots.length === lots.length
                          ? `${lots.length} lot(s)`
                          : `${filteredLots.length} / ${lots.length} lot(s)`}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              )}

              {lotsLoading ? (
                <Card>
                  <CardContent className="py-12 text-center text-gray-400 text-sm">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-3 text-gray-300" />
                    Chargement des lots...
                  </CardContent>
                </Card>
              ) : lots.length === 0 ? (
                <Card>
                  <CardContent className="py-16 text-center">
                    <Package className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500 font-medium">Aucun lot enregistré</p>
                    <p className="text-sm text-gray-400 mt-1">
                      Générez des vouchers pour créer votre premier lot
                    </p>
                  </CardContent>
                </Card>
              ) : filteredLots.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center">
                    <Search className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500 font-medium">Aucun lot trouvé</p>
                    <p className="text-sm text-gray-400 mt-1">Modifiez la recherche ou réinitialisez les filtres</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {filteredLots.map((lot) => (
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
                              {canonicalVendorFromLot(lot.name) && (
                                <>
                                  <span className="text-gray-300">·</span>
                                  <span className="text-xs font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                                    {canonicalVendorFromLot(lot.name)}
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
                            {u.username}
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

      {/* Reset user confirmation dialog */}
      <AlertDialog open={!!confirmResetUser} onOpenChange={(o) => { if (!o && !isResetting) setConfirmResetUser(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Réinitialiser l'utilisateur ?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-gray-600">
                <p>
                  L'utilisateur <span className="font-mono font-semibold">{confirmResetUser?.username}</span> sera supprimé puis recréé avec les mêmes identifiants :
                </p>
                <ul className="list-disc pl-4 space-y-1 text-gray-500">
                  <li>Suppression de l'utilisateur sur MikroTik</li>
                  <li>Recréation avec le même nom, mot de passe et profil</li>
                  <li>Compteurs (uptime, octets) repartent à zéro</li>
                  <li>Session active déconnectée</li>
                  <li>Marqué comme non vendu en base de données</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isResetting}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleResetUser()}
              disabled={isResetting}
              className="bg-orange-600 hover:bg-orange-700"
            >
              {isResetting ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Réinitialisation…</> : "Réinitialiser"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit user dialog (Mikhmon-style) */}
      <Dialog open={!!editingUser} onOpenChange={(o) => { if (!o && !isSavingRename) setEditingUser(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Modifier l'utilisateur</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-gray-500">Utilisateur actuel</Label>
              <p className="font-mono text-sm bg-gray-50 rounded px-3 py-2 border border-gray-200">
                {editingUser?.username}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-username" className="text-xs text-gray-500">Identifiant</Label>
              <Input
                id="edit-username"
                value={editUsername}
                onChange={(e) => setEditUsername(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void handleRenameUser(); }}
                placeholder="Nom d'utilisateur..."
                className="font-mono"
                autoFocus
                disabled={isSavingRename}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-password" className="text-xs text-gray-500">Mot de passe</Label>
              <div className="relative">
                <Input
                  id="edit-password"
                  type={editShowPassword ? "text" : "password"}
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  className="font-mono pr-10"
                  disabled={isSavingRename}
                />
                <button
                  type="button"
                  onClick={() => setEditShowPassword((v) => !v)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-8 flex items-center justify-center rounded bg-gray-100 text-gray-600 hover:bg-gray-200"
                >
                  {editShowPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-profile" className="text-xs text-gray-500">Forfait (profil)</Label>
              <select
                id="edit-profile"
                className="w-full h-9 border border-input bg-background rounded-md px-3 text-sm"
                value={editProfile}
                onChange={(e) => setEditProfile(e.target.value)}
                disabled={isSavingRename}
              >
                <option value="">Sélectionner un profil</option>
                {sortedProfiles.map((p) => (
                  <option key={p.name} value={p.name}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="link-bypass"
                type="checkbox"
                checked={linkBypass}
                onChange={(e) => setLinkBypass(e.target.checked)}
                disabled={isSavingRename}
              />
              <Label htmlFor="link-bypass" className="text-sm text-gray-600">Lier un bypass MAC automatique</Label>
            </div>
            {linkBypass && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-bypass-comment" className="text-xs text-gray-500">Rechercher un bypass (commentaire)</Label>
                  <Input
                    id="edit-bypass-comment"
                    list="bypass-comment-options"
                    value={editBypassComment}
                    onChange={(e) => {
                      const value = e.target.value;
                      setEditBypassComment(value);
                      const match = bypassBindings.find((b) => (b.comment ?? "").toLowerCase() === value.trim().toLowerCase());
                      if (match?.macAddress) setEditBypassMac(match.macAddress);
                    }}
                    placeholder="Tapez pour rechercher un commentaire bypass..."
                    disabled={isSavingRename}
                  />
                  <datalist id="bypass-comment-options">
                    {bypassBindings
                      .filter((b) => !!b.comment && !!b.macAddress)
                      .slice(0, 200)
                      .map((b) => (
                        <option key={b.id} value={b.comment}>
                          {b.macAddress}
                        </option>
                      ))}
                  </datalist>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-bypass-mac" className="text-xs text-gray-500">Adresse MAC bypass (ou saisie directe)</Label>
                  <Input
                    id="edit-bypass-mac"
                    value={editBypassMac}
                    onChange={(e) => setEditBypassMac(e.target.value)}
                    placeholder="AA:BB:CC:DD:EE:FF"
                    className="font-mono"
                    disabled={isSavingRename}
                  />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingUser(null)} disabled={isSavingRename}>
              Annuler
            </Button>
            <Button
              onClick={() => void handleRenameUser()}
              disabled={
                isSavingRename ||
                !editUsername.trim() ||
                !editPassword.trim() ||
                !editProfile.trim() ||
                (linkBypass && !editBypassMac.trim() && !editBypassComment.trim())
              }
            >
              {isSavingRename ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Enregistrement...</> : "Enregistrer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add User dialog (Mikhmon-style) ────────────────────────────────── */}
      <Dialog open={addUserOpen} onOpenChange={(o) => { if (!isSavingUser) setAddUserOpen(o); }}>
        <DialogContent className="max-w-md p-0 overflow-hidden bg-slate-700 text-slate-100 border-slate-600 sm:rounded-md">
          {/* Header */}
          <DialogHeader className="px-4 pt-3 pb-2 border-b border-slate-600 bg-slate-700">
            <DialogTitle className="text-base font-semibold flex items-center gap-2 text-slate-100">
              <UserPlus className="h-4 w-4" /> Add User
            </DialogTitle>
          </DialogHeader>

          {/* Action buttons (Close / Save) — Mikhmon style */}
          <div className="flex items-center gap-2 px-4 pt-3 pb-3 bg-slate-700">
            <Button
              type="button"
              size="sm"
              onClick={() => setAddUserOpen(false)}
              disabled={isSavingUser}
              className="bg-amber-500 hover:bg-amber-600 text-white gap-1.5"
            >
              <X className="h-3.5 w-3.5" /> Close
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSaveUser}
              disabled={isSavingUser}
              className="bg-cyan-500 hover:bg-cyan-600 text-white gap-1.5"
            >
              {isSavingUser ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save
            </Button>
          </div>

          {/* Form grid (label left, input right — Mikhmon layout) */}
          <div className="px-4 pb-4 space-y-3 bg-slate-700">
            {/* Server */}
            <div className="grid grid-cols-[90px_1fr] items-center gap-3">
              <Label className="text-sm text-slate-200 font-normal">Server</Label>
              <Popover open={addServerPopoverOpen} onOpenChange={setAddServerPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between font-normal bg-slate-600 border-slate-500 text-slate-100 hover:bg-slate-500 hover:text-white"
                  >
                    <span className="truncate">{addServer || "all"}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-70" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-1" align="start">
                  {/* "all" maps to RouterOS default (any hotspot server). We
                      avoid hardcoding specific server names to prevent invalid
                      submissions on routers without that name. */}
                  <button
                    type="button"
                    onClick={() => { setAddServer("all"); setAddServerPopoverOpen(false); }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-sm rounded hover:bg-gray-100 text-left"
                  >
                    <Check className={`h-3.5 w-3.5 ${addServer === "all" ? "opacity-100 text-blue-600" : "opacity-0"}`} />
                    all
                  </button>
                </PopoverContent>
              </Popover>
            </div>

            {/* Name */}
            <div className="grid grid-cols-[90px_1fr] items-center gap-3">
              <Label className="text-sm text-slate-200 font-normal">Name</Label>
              <Input
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                disabled={isSavingUser}
                className="bg-slate-600 border-slate-500 text-slate-100 placeholder:text-slate-400 focus-visible:ring-cyan-500"
                autoComplete="off"
              />
            </div>

            {/* Password (with eye toggle) */}
            <div className="grid grid-cols-[90px_1fr] items-center gap-3">
              <Label className="text-sm text-slate-200 font-normal">Password</Label>
              <div className="relative">
                <Input
                  type={addShowPassword ? "text" : "password"}
                  value={addPassword}
                  onChange={(e) => setAddPassword(e.target.value)}
                  disabled={isSavingUser}
                  className="bg-slate-600 border-slate-500 text-slate-100 placeholder:text-slate-400 focus-visible:ring-cyan-500 pr-10"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setAddShowPassword((v) => !v)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-8 flex items-center justify-center rounded bg-white text-slate-700 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-500"
                  aria-label={addShowPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                  aria-pressed={addShowPassword}
                >
                  {addShowPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>

            {/* Profile */}
            <div className="grid grid-cols-[90px_1fr] items-center gap-3">
              <Label className="text-sm text-slate-200 font-normal">Profile</Label>
              <Popover open={addProfilePopoverOpen} onOpenChange={setAddProfilePopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between font-normal bg-slate-600 border-slate-500 text-slate-100 hover:bg-slate-500 hover:text-white"
                  >
                    <span className="truncate">{addProfile || "—"}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-70" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-1 max-h-64 overflow-y-auto" align="start">
                  {sortedProfiles.length === 0 && (
                    <p className="px-3 py-2 text-xs text-gray-400">Aucun profil disponible.</p>
                  )}
                  {sortedProfiles.map((p) => (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => { setAddProfile(p.name); setAddProfilePopoverOpen(false); }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-sm rounded hover:bg-gray-100 text-left"
                    >
                      <Check className={`h-3.5 w-3.5 ${addProfile === p.name ? "opacity-100 text-blue-600" : "opacity-0"}`} />
                      <span className="truncate">{p.name}</span>
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            </div>

            {/* Time Limit */}
            <div className="grid grid-cols-[90px_1fr] items-center gap-3">
              <Label className="text-sm text-slate-200 font-normal">Time Limit</Label>
              <Input
                value={addTimeLimit}
                onChange={(e) => setAddTimeLimit(e.target.value)}
                disabled={isSavingUser}
                placeholder="ex: 30d, 12h, 4w3d"
                className="bg-slate-600 border-slate-500 text-slate-100 placeholder:text-slate-400 focus-visible:ring-cyan-500"
              />
            </div>

            {/* Data Limit (input + unit) */}
            <div className="grid grid-cols-[90px_1fr] items-center gap-3">
              <Label className="text-sm text-slate-200 font-normal">Data Limit</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min="0"
                  value={addDataLimit}
                  onChange={(e) => setAddDataLimit(e.target.value)}
                  disabled={isSavingUser}
                  className="flex-1 bg-slate-600 border-slate-500 text-slate-100 placeholder:text-slate-400 focus-visible:ring-cyan-500"
                />
                <Popover open={addUnitPopoverOpen} onOpenChange={setAddUnitPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      className="w-20 justify-between font-normal bg-slate-600 border-slate-500 text-slate-100 hover:bg-slate-500 hover:text-white"
                    >
                      {addDataUnit}
                      <ChevronsUpDown className="ml-1 h-3.5 w-3.5 opacity-70" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-20 p-1" align="end">
                    {(["MB", "GB"] as const).map((u) => (
                      <button
                        key={u}
                        type="button"
                        onClick={() => { setAddDataUnit(u); setAddUnitPopoverOpen(false); }}
                        className="flex w-full items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-gray-100 text-left"
                      >
                        <Check className={`h-3.5 w-3.5 ${addDataUnit === u ? "opacity-100 text-blue-600" : "opacity-0"}`} />
                        {u}
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Comment */}
            <div className="grid grid-cols-[90px_1fr] items-center gap-3">
              <Label className="text-sm text-slate-200 font-normal">Comment</Label>
              <Input
                value={addComment}
                onChange={(e) => setAddComment(e.target.value)}
                disabled={isSavingUser}
                className="bg-slate-600 border-slate-500 text-slate-100 placeholder:text-slate-400 focus-visible:ring-cyan-500"
              />
            </div>
          </div>

          {/* Read Me section */}
          <div className="border-t border-slate-600 bg-slate-700">
            <div className="px-4 py-2 border-b border-slate-600">
              <h4 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <BookOpen className="h-4 w-4" /> Read Me
              </h4>
            </div>
            <div className="px-4 py-3 text-xs text-slate-300 space-y-2 leading-relaxed">
              <p>
                <strong>Format Time Limit.</strong>
                <br />
                [wdhm] Example : 30d = 30days, 12h = 12hours, 4w3d = 31days.
              </p>
              <p>
                Add User with Time Limit.
                <br />
                Should Time Limit &lt; Validity.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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

// Parse a MikroTik comment that may contain an expiration date set by the
// hotspot on-login script. Common formats observed:
//   "mmm/dd/yyyy HH:mm:ss"   e.g. "jan/12/2026 14:30:00"
//   "YYYY-MM-DD HH:mm:ss"    e.g. "2026-01-12 14:30:00"
//   "YYYY-MM-DD mmm/dd/yyyy HH:mm:ss" (combined — take the trailing date)
// Returns a Date if a valid timestamp can be parsed, otherwise null.
const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
function parseExpirationDate(comment: string | null | undefined): Date | null {
  if (!comment) return null;
  const c = comment.trim();
  if (!c) return null;
  // Skip lot tags ("vc-lotname", "up-lotname") — these are unused vouchers.
  if (/^(vc|up)[-_]/i.test(c)) return null;

  // Try "mmm/dd/yyyy HH:mm:ss" anywhere in the string (last match wins).
  const mtkRe = /([a-z]{3})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/gi;
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = mtkRe.exec(c)) !== null) last = m;
  if (last) {
    const month = MONTHS[last[1].toLowerCase()];
    if (month != null) {
      const d = new Date(Number(last[3]), month, Number(last[2]), Number(last[4]), Number(last[5]), Number(last[6] ?? 0));
      if (!isNaN(d.getTime())) return d;
    }
  }

  // Try "YYYY-MM-DD HH:mm[:ss]"
  const isoRe = /(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/;
  const i = isoRe.exec(c);
  if (i) {
    const d = new Date(Number(i[1]), Number(i[2]) - 1, Number(i[3]), Number(i[4]), Number(i[5]), Number(i[6] ?? 0));
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}
function isExpired(comment: string | null | undefined): boolean {
  const d = parseExpirationDate(comment);
  if (!d) return false;
  return d.getTime() < Date.now();
}

function isUnlimitedProfile(profile: string | null | undefined): boolean {
  if (!profile) return false;
  const p = profile.toLowerCase();
  return (
    p.includes("illim")
    || p.includes("unlimit")
    || p.includes("unlimited")
    || p.includes("infinite")
    || p.includes("free")
    || p.includes("sans exp")
    || p.includes("no-exp")
    || p.includes("noexp")
    || p.includes("permanent")
  );
}

function UserRow({
  user,
  isExpired: expired,
  selected,
  onToggle,
  onEdit,
  onReset,
}: {
  user: HotspotUser;
  isExpired: boolean;
  selected: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onReset: () => void;
}) {
  return (
    <div
      className={`flex items-center justify-between px-3 sm:px-4 py-3 hover:bg-gray-50 group ${selected ? "bg-blue-50" : ""}`}
    >
      <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
        <input type="checkbox" checked={selected} onChange={onToggle} className="h-4 w-4 rounded flex-shrink-0" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold text-sm">{user.username}</span>
            {expired && (
              <span className="text-[10px] uppercase tracking-wide font-semibold bg-red-100 text-red-700 px-1.5 py-0.5 rounded">
                Expiré
              </span>
            )}
          </div>
          <div className="text-xs text-gray-400 mt-0.5 flex flex-wrap gap-2">
            <span>{user.profile}</span>
            {user.comment && (
              <>
                <span>·</span>
                <span className={`font-mono px-1 rounded ${expired ? "bg-red-50 text-red-600" : "bg-gray-100"}`}>
                  {user.comment}
                </span>
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

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            onClick={(e) => e.stopPropagation()}
            className="ml-2 flex-shrink-0 p-1.5 rounded text-gray-300 hover:text-gray-600 hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition-opacity"
            title="Actions"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[160px]">
          <DropdownMenuItem
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            className="gap-2 cursor-pointer"
          >
            <Pencil className="h-3.5 w-3.5" />
            Modifier utilisateur
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => { e.stopPropagation(); onReset(); }}
            className="gap-2 cursor-pointer text-orange-600 focus:text-orange-600"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Réinitialiser
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
