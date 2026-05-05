import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useListRouterUsers,
  useListRouterProfiles,
  getListRouterUsersQueryKey,
  getListRouterProfilesQueryKey,
} from "@workspace/api-client-react";
import type { HotspotUser, HotspotUserListResponse } from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";
import { sortRouterProfilesByCreationOrder } from "@/lib/routerProfilesSort";
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
  CalendarPlus,
  FilePlus2,
  CheckCircle2,
  Copy,
} from "lucide-react";
import { PasswordInput } from "@/components/ui/password-input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/use-debounce";
import { fetchServerTemplate } from "@/pages/TicketTemplate";
import { printTickets, tryOpenVoucherPrintPage } from "@/lib/print";
import { useProfileAutoResync } from "@/hooks/use-profile-auto-resync";
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

function makeClientBatchId(mode: "vc" | "up"): string {
  const now = new Date();
  const M = String(now.getMonth() + 1).padStart(2, "0");
  const D = String(now.getDate()).padStart(2, "0");
  const Y = String(now.getFullYear()).slice(-2);
  const rand = String(Math.floor(Math.random() * 900) + 100);
  return `${mode}-${rand}-${M}.${D}.${Y}`;
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
  const [printingLot, setPrintingLot] = useState<string | null>(null);
  const [deletingLot, setDeletingLot] = useState<string | null>(null);
  const [isDeletingLot, setIsDeletingLot] = useState(false);
  const [deletingLotName, setDeletingLotName] = useState<string | null>(null);
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
  const [isSavingRename, setIsSavingRename] = useState(false);
  const [confirmResetUser, setConfirmResetUser] = useState<HotspotUser | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [confirmDeleteEditUser, setConfirmDeleteEditUser] = useState<HotspotUser | null>(null);
  const [isDeletingEditUser, setIsDeletingEditUser] = useState(false);
  const [isTogglingEditUserDisabled, setIsTogglingEditUserDisabled] = useState(false);
  const [extendUser, setExtendUser] = useState<HotspotUser | null>(null);
  const [extendAmount, setExtendAmount] = useState("1");
  const [extendUnit, setExtendUnit] = useState<"Heure" | "Jour" | "Mois">("Mois");
  const [isExtending, setIsExtending] = useState(false);
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
  const [addDialogMode, setAddDialogMode] = useState<"create" | "edit" | "recap">("create");
  const [addEditOriginalName, setAddEditOriginalName] = useState("");
  const [addEditLoading, setAddEditLoading] = useState(false);
  const [addRecapUser, setAddRecapUser] = useState<{ name: string; password: string; profile: string; server: string; limitUptime: string; limitBytes: string; comment: string } | null>(null);

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
  const lotVendorByComment = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of lots) {
      const v = canonicalVendorFromLot(l.name);
      if (v) map.set(String(l.name ?? ""), v);
    }
    return map;
  }, [lots, vendorAliasMap]);

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
  const usersLimit = filterVendor !== "all" ? 20_000 : 2_000;
  const usersParams = {
    search: debouncedSearch || undefined,
    profile: filterProfile !== "all" ? filterProfile : undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(filterComment !== "all" ? { comment: filterComment } : {}),
    limit: usersLimit,
  } as Parameters<typeof useListRouterUsers>[1];
  const {
    data: allUsersData,
    isLoading: usersLoading,
    isFetching,
    refetch: refetchUsers,
    error,
  } = useListRouterUsers(
    activeRouterId ?? 0,
    usersParams,
    {
      query: {
        queryKey: getListRouterUsersQueryKey(activeRouterId ?? 0, usersParams),
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
    query: { queryKey: getListRouterProfilesQueryKey(activeRouterId ?? 0), enabled: !!activeRouterId, staleTime: 120_000 },
  });
  useProfileAutoResync(activeRouterId, { intervalMs: 5 * 60_000, refreshProfiles: true, syncNames: true });
  const profileExpiryModeByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of (profilesList as unknown as Array<Record<string, unknown>>)) {
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
      base = base.filter((u) => {
        const comment = String(u.comment ?? "");
        const byLotMap = lotVendorByComment.get(comment);
        if (byLotMap) return byLotMap === filterVendor;
        return canonicalVendorFromLot(comment) === filterVendor;
      });
    }
    if (filterStatus === "all") return base;
    if (filterStatus === "disabled") return base.filter((u) => !!u.disabled);
    if (filterStatus === "active") return base.filter((u) => !u.disabled);
    return base.filter((u) => !u.disabled && userIsExpired(u));
  }, [allUsersData?.users, filterVendor, filterStatus, profileExpiryModeByName, vendorAliasMap, lotVendorByComment]);
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

  const sortedProfiles = useMemo(
    () => sortRouterProfilesByCreationOrder(profilesList),
    [profilesList],
  );

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

  const handleToggleEditUserDisabled = async () => {
    if (!activeRouterId || !editingUser || isTogglingEditUserDisabled || isSavingRename) return;
    const u = editingUser.username;
    const enable = !!editingUser.disabled;
    const snapshot = optimisticSetDisabled(activeRouterId, new Set([u]), !enable);
    setIsTogglingEditUserDisabled(true);
    try {
      const res = await fetch(`${BASE}/api/vouchers/users-toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routerId: activeRouterId, usernames: [u], enable }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEditingUser((prev) => (prev && prev.username === u ? { ...prev, disabled: !enable } : prev));
      toast({ title: enable ? "Utilisateur réactivé" : "Utilisateur désactivé", description: u });
      void refetchLots();
      void refetchUsers();
    } catch (err) {
      for (const [key, val] of snapshot) queryClient.setQueryData(key, val);
      toast({ title: "Erreur", description: String(err), variant: "destructive" });
    } finally {
      setIsTogglingEditUserDisabled(false);
    }
  };

  // ── Delete selected usernames ────────────────────────────────────────────────
  const handleDeleteSelected = async () => {
    if (!activeRouterId || selectedUsernames.size === 0 || isDeletingSelected) return;
    const usernames = [...selectedUsernames];
    setIsDeletingSelected(true);
    setConfirmDeleteSelected(false);
    try {
      const res = await fetch(`${BASE}/api/routers/${activeRouterId}/users`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usernames }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { deleted: number };
      setSelectedUsernames(new Set());
      toast({
        title: `${data.deleted} voucher(s) supprimé(s)`,
        description: `Profil : ${filterProfile}`,
      });
      void refetchUsers();
      void refetchLots();
    } catch (err) {
      toast({ title: "Erreur suppression", description: String(err), variant: "destructive" });
    } finally {
      setIsDeletingSelected(false);
    }
  };

  const handleConfirmDeleteEditUser = async () => {
    if (!activeRouterId || !confirmDeleteEditUser || isDeletingEditUser) return;
    const user = confirmDeleteEditUser;
    setIsDeletingEditUser(true);
    try {
      const res = await fetch(`${BASE}/api/routers/${activeRouterId}/users`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usernames: [user.username] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { deleted: number };
      toast({
        title: `${data.deleted} voucher supprimé`,
        description: user.username,
      });
      setSelectedUsernames((prev) => {
        const next = new Set(prev);
        next.delete(user.username);
        return next;
      });
    } catch (err) {
      toast({ title: "Erreur suppression", description: String(err), variant: "destructive" });
    } finally {
      setIsDeletingEditUser(false);
      setConfirmDeleteEditUser(null);
      void refetchUsers();
      void refetchLots();
    }
  };

  // ── Lot delete — removes users from MikroTik ────────────────────────────────
  const handleDeleteLot = async (lotName: string) => {
    if (!activeRouterId || isDeletingLot) return;
    setIsDeletingLot(true);
    setDeletingLotName(lotName);
    setDeletingLot(null);
    if (filterComment === lotName) setFilterComment("all");
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
    } catch (err) {
      toast({ title: "Erreur suppression", description: String(err), variant: "destructive" });
    } finally {
      setIsDeletingLot(false);
      setDeletingLotName(null);
      void refetchUsers();
      void refetchLots();
    }
  };

  // ── Print lot — fetches all users for a lot and prints their tickets ─────────
  const handlePrintLot = async (lot: LotSummary) => {
    const hotspotName = (activeRouter as { hotspotName?: string } | undefined)?.hotspotName || activeRouter?.name || "";
    if (await tryOpenVoucherPrintPage(lot.name, hotspotName)) {
      toast({
        title: "Impression Mikhmon",
        description: "Ouverture de la page print.php (mobile) pour refresh/réimpression.",
      });
      return;
    }
    const php = await fetchServerTemplate();
    setPrintingLot(lot.name);
    try {
      const users = await fetchLotUsers(lot);
      if (users.length === 0) {
        toast({ title: "Lot vide", description: "Aucun voucher dans ce lot.", variant: "destructive" });
        return;
      }
      const toSlug = (s: string) => s.trim().replace(/\s+/g, "-");
      const vouchers = users.map((user, idx) => {
        const profile = profilesList.find((p) => p.name === user.profile);
        return {
          hotspotname: hotspotName,
          dnsname: (activeRouter as { contact?: string } | undefined)?.contact ?? "",
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
      const resp = await fetch(`${BASE}/api/render-tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ php, vouchers }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as { error?: string };
        toast({ title: "Erreur rendu tickets", description: err.error ?? `HTTP ${resp.status}`, variant: "destructive" });
        return;
      }
      const data = await resp.json() as { html: string[] };
      if (!data.html?.length) {
        toast({ title: "Aucun ticket généré", description: "Le modèle n'a rien retourné.", variant: "destructive" });
        return;
      }
      const printParts = ["Voucher", toSlug(hotspotName), lot.name].filter(Boolean);
      try {
        printTickets(data.html, printParts.join("-"));
      } catch {
        toast({ title: "Impression bloquée", description: "Autorisez les popups pour ce site puis réessayez.", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Erreur impression", description: String(err), variant: "destructive" });
    } finally {
      setPrintingLot(null);
    }
  };

  // ── Print ────────────────────────────────────────────────────────────────────
  const handlePrintVouchers = async () => {
    const usersForPrint = selectedUsernames.size > 0
      ? filtered.filter((u) => selectedUsernames.has(u.username))
      : filtered;
    if (usersForPrint.length === 0) {
      toast({ title: "Aucun voucher à imprimer", description: "Sélectionnez un lot ou des vouchers d'abord.", variant: "destructive" });
      return;
    }
    const hotspotName = (activeRouter as any)?.hotspotName || activeRouter?.name || "";
    const uniqueLots = new Set(usersForPrint.map((u) => (u.comment ?? "").trim()).filter(Boolean));
    if (uniqueLots.size === 1) {
      const [lotId] = [...uniqueLots];
      if (lotId && await tryOpenVoucherPrintPage(lotId, hotspotName)) {
        toast({
          title: "Impression Mikhmon",
          description: "Ouverture de la page print.php (mobile) pour refresh/réimpression.",
        });
        return;
      }
    }
    const php = await fetchServerTemplate();
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

    const previousUsername = editingUser.username;
    const payload = {
      newUsername: nextUsername,
      password: nextPassword,
      profile: nextProfile,
      linkBypass,
      bypassMacAddress: linkBypass ? nextBypassMac : undefined,
      bypassComment: linkBypass ? editBypassComment.trim() : undefined,
    };
    setEditingUser(null);
    setIsSavingRename(false);
    toast({ title: "Modification lancée", description: `${previousUsername} → ${nextUsername}` });
    void (async () => {
      try {
        const res = await fetch(
          `${BASE}/api/routers/${activeRouterId}/users/${encodeURIComponent(previousUsername)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        );
        if (!res.ok) {
          const err = await res.json() as { error?: string };
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        toast({ title: "Utilisateur modifié", description: `${previousUsername} mis à jour.` });
      } catch (err) {
        toast({ title: "Erreur modification", description: String(err), variant: "destructive" });
      } finally {
        void Promise.all([refetchUsers(), refetchLots()]);
      }
    })();
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
      const resetResult = (await res.json()) as {
        sessionKicked?: number;
        cookiesRemoved?: number;
        schedulerRemoved?: number;
      };

      // 3. Rechargement immédiat — le serveur a déjà patché son cache
      //    in-memory (commentaire vidé, limites/quotas remis à zéro), donc
      //    le refetch revient instantanément sans round-trip MikroTik.
      await Promise.all([refetchUsers(), refetchLots()]);
      resetToast.update({
        id: resetToast.id,
        title: "Réinitialisation réussie",
        description: `${user.username} réinitialisé — sessions coupées: ${resetResult.sessionKicked ?? 0}, cookies supprimés: ${resetResult.cookiesRemoved ?? 0}, scheduler supprimé: ${resetResult.schedulerRemoved ?? 0}.`,
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

  const openExtendUser = (user: HotspotUser) => {
    setExtendUser(user);
    setExtendAmount("1");
    setExtendUnit("Mois");
  };

  const handleExtend = async () => {
    if (!activeRouterId || !extendUser || isExtending) return;
    const n = parseInt(extendAmount, 10);
    if (!n || n <= 0) {
      toast({ title: "Durée invalide", description: "Entrez un nombre positif.", variant: "destructive" });
      return;
    }
    const user = extendUser;
    setExtendUser(null);
    setIsExtending(true);
    try {
      const existing = parseExpirationDate(user.comment);
      const isExpired = !existing || existing.getTime() <= Date.now();

      // Si expiré → réinitialiser le compte (compteurs, session, MAC) avant d'appliquer la nouvelle date
      if (isExpired) {
        const resetRes = await fetch(
          `${BASE}/api/routers/${activeRouterId}/users/${encodeURIComponent(user.username)}/reset`,
          { method: "POST", headers: { "Content-Type": "application/json" } },
        );
        if (!resetRes.ok) {
          const err = await resetRes.json() as { error?: string };
          throw new Error(err.error ?? `HTTP ${resetRes.status}`);
        }
      }

      // Calculer la nouvelle date d'expiration
      const base = isExpired ? new Date() : existing!;
      const next = new Date(base);
      if (extendUnit === "Heure") next.setHours(next.getHours() + n);
      else if (extendUnit === "Jour") next.setDate(next.getDate() + n);
      else next.setMonth(next.getMonth() + n);
      const newComment = formatMikrotikDate(next);

      const patchRes = await fetch(
        `${BASE}/api/routers/${activeRouterId}/users/${encodeURIComponent(user.username)}`,
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ comment: newComment }) },
      );
      if (!patchRes.ok) {
        const err = await patchRes.json() as { error?: string };
        throw new Error(err.error ?? `HTTP ${patchRes.status}`);
      }
      toast({
        title: isExpired ? "Compte réinitialisé et prolongé" : "Forfait prolongé",
        description: `${user.username} — expire : ${newComment}`,
      });
      void Promise.all([refetchUsers(), refetchLots()]);
    } catch (err) {
      toast({ title: "Erreur prolongation", description: String(err), variant: "destructive" });
    } finally {
      setIsExtending(false);
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
    setAddDialogMode("create");
    setAddEditOriginalName("");
    setAddEditLoading(false);
    setAddRecapUser(null);
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

    const creatingName = addName.trim();
    const body: Record<string, string> = {
      name: creatingName,
      password: addPassword.trim(),
      profile: addProfile.trim(),
    };
    if (addServer && addServer !== "all") body.server = addServer.trim();
    if (addTimeLimit.trim()) body.limitUptime = addTimeLimit.trim();
    const bytes = bytesFromInput(addDataLimit, addDataUnit);
    if (bytes) body.limitBytesTotal = bytes;
    if (addComment.trim()) body.comment = addComment.trim();

    setIsSavingUser(true);
    try {
      const res = await fetch(`${BASE}/api/routers/${activeRouterId}/hotspot-users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        toast({
          title: "Échec de la création",
          description: err?.error || `HTTP ${res.status}`,
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Utilisateur ajouté", description: `${creatingName} créé sur MikroTik.` });
      const recapBytes = bytes ?? "";
      setAddRecapUser({
        name: creatingName,
        password: addPassword.trim(),
        profile: addProfile.trim(),
        server: addServer || "all",
        limitUptime: addTimeLimit.trim(),
        limitBytes: recapBytes,
        comment: addComment.trim(),
      });
      setAddEditOriginalName(creatingName);
      setAddDialogMode("recap");
      void refetchUsers();
      void refetchLots();
      void queryClient.invalidateQueries({ queryKey: [`/routers/${activeRouterId}/users/count`] });
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

  async function handleEditSavedUser() {
    if (!activeRouterId || !addEditOriginalName) return;
    setAddEditLoading(true);
    try {
      const res = await fetch(
        `${BASE}/api/routers/${activeRouterId}/users/${encodeURIComponent(addEditOriginalName)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            newUsername: addName.trim(),
            password: addPassword.trim(),
            profile: addProfile.trim(),
            linkBypass: false,
          }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        toast({ title: "Erreur modification", description: err?.error || `HTTP ${res.status}`, variant: "destructive" });
      } else {
        setAddEditOriginalName(addName.trim());
        toast({ title: "Utilisateur modifié", description: `${addName.trim()} mis à jour.` });
        void Promise.all([refetchUsers(), refetchLots()]);
      }
    } catch (e) {
      toast({ title: "Erreur modification", description: String(e), variant: "destructive" });
    } finally {
      setAddEditLoading(false);
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
              <span className="hidden sm:inline">Ajouter un client</span>
            </Button>
            {view === "list" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={isFetching}
                className=""
              >
                <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
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
                  <div className="space-y-1.5 md:space-y-0 md:flex md:flex-nowrap md:items-center md:gap-1 md:overflow-hidden">

                    {/* Ligne 1 mobile : recherche + ↻ */}
                    <div className="flex items-center gap-2 md:contents">
                      <div className="relative flex-1 min-w-0 md:flex-none md:w-[21%]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                        <Input
                          className="pl-8 h-8 text-xs"
                          placeholder="Rechercher par code, nom, commentaire..."
                          value={search}
                          onChange={(e) => handleSearchChange(e.target.value)}
                        />
                      </div>
                      <span className="flex-shrink-0 text-[11px] text-gray-400 md:w-[7%] md:text-right">↻ 30s</span>
                    </div>

                    {/* Ligne 2 mobile : 4 filtres sur la même ligne */}
                    <div className="flex gap-1 md:contents">
                      {/* Combobox — Forfait */}
                      <Popover open={profilePopoverOpen} onOpenChange={setProfilePopoverOpen}>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            role="combobox"
                            aria-expanded={profilePopoverOpen}
                            className="flex-1 min-w-0 md:flex-none md:w-[14%] justify-between font-normal text-[11px] h-8 px-1.5"
                          >
                            <span className="truncate">
                              {filterProfile === "all"
                                ? <><span className="md:hidden">Forfaits</span><span className="hidden md:inline">Tous les forfaits</span></>
                                : filterProfile}
                            </span>
                            <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
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
                            className="flex-1 min-w-0 md:flex-none md:w-[17%] justify-between font-normal text-[11px] h-8 px-1.5"
                          >
                            <span className="font-mono text-[11px] truncate">
                              {filterComment === "all"
                                ? <><span className="md:hidden">Lots</span><span className="hidden md:inline">Tous les lots</span></>
                                : filterComment}
                            </span>
                            <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
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
                            className={`flex-1 min-w-0 md:flex-none md:w-[15%] justify-between font-normal text-[11px] h-8 px-1.5 ${filterVendor !== "all" ? "border-blue-400 text-blue-700 bg-blue-50" : ""}`}
                          >
                            <span className="truncate">
                              {filterVendor === "all"
                                ? <><span className="md:hidden">Vendeurs</span><span className="hidden md:inline">Tous les vendeurs</span></>
                                : filterVendor}
                            </span>
                            <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
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
                            className={`flex-1 min-w-0 md:flex-none md:w-[13%] justify-between font-normal text-[11px] h-8 px-1.5 ${filterStatus !== "all" ? "border-blue-400 text-blue-700 bg-blue-50" : ""}`}
                          >
                            <span className="truncate">
                              {filterStatus === "all"
                                ? <><span className="md:hidden">Statut</span><span className="hidden md:inline">Tous statuts</span></>
                                : filterStatus === "expired"
                                  ? "Expirés"
                                  : filterStatus === "disabled"
                                    ? "Désactivés"
                                    : "Activés"}
                            </span>
                            <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
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
                    </div>

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
                      disabled={isDeletingLot}
                      className="gap-1.5 text-red-500 hover:text-red-700 hover:bg-red-50"
                    >
                      {isDeletingLot && deletingLotName === filterComment
                        ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        : <Trash2 className="h-3.5 w-3.5" />}
                      Supprimer
                    </Button>
                  </div>
                </div>
              )}

              {/* Selection banner — shown when at least one user is ticked */}
              {(filterProfile !== "all" || selectedUsernames.size > 0) && (
                <div className="flex items-center gap-2 mb-3 bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5 flex-wrap min-h-[36px]">

                  {/* Left — count badge + deselect / select-all */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {selectedUsernames.size > 0 ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setSelectedUsernames(new Set())}
                          className="flex items-center justify-center h-5 w-5 rounded-full bg-blue-200 hover:bg-blue-300 text-blue-600 hover:text-blue-800 transition-colors flex-shrink-0"
                          title="Désélectionner tout"
                        >
                          <X className="h-3 w-3" />
                        </button>
                        <span className="inline-flex items-center bg-blue-600 text-white text-xs font-semibold px-2 py-0.5 rounded-full tabular-nums">
                          {selectedUsernames.size} sélectionné{selectedUsernames.size > 1 ? "s" : ""}
                        </span>
                      </>
                    ) : (
                      filterProfile !== "all" && filteredTotal > 0 && (
                        <button
                          type="button"
                          onClick={handleSelectAllProfile}
                          disabled={isSelectingAll}
                          className="text-xs text-blue-600 hover:text-blue-800 underline underline-offset-2 transition-colors disabled:opacity-50"
                        >
                          {isSelectingAll ? "…" : `Tout sélectionner (${filteredTotal.toLocaleString("fr")})`}
                        </button>
                      )
                    )}
                  </div>

                  {/* Actions — only when something is selected */}
                  {selectedUsernames.size > 0 && (
                    <>
                      <div className="h-4 w-px bg-blue-200 flex-shrink-0" />

                      {/* Imprimer */}
                      <button
                        type="button"
                        onClick={handlePrintVouchers}
                        disabled={isPrinting}
                        className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 hover:bg-blue-100 px-2 py-1 rounded transition-colors disabled:opacity-40"
                      >
                        {isPrinting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Printer className="h-3 w-3" />}
                        <span>Imprimer</span>
                      </button>

                      <div className="h-4 w-px bg-blue-200 flex-shrink-0" />

                      {/* Activer / Désactiver */}
                      <button
                        type="button"
                        onClick={() => setConfirmToggleSelected(true)}
                        disabled={isTogglingSelected}
                        className="flex items-center gap-1 text-xs text-green-600 hover:text-green-800 hover:bg-green-50 px-2 py-1 rounded transition-colors disabled:opacity-40"
                      >
                        <Power className="h-3 w-3" />
                        <span>Activer</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmToggleSelected(false)}
                        disabled={isTogglingSelected}
                        className="flex items-center gap-1 text-xs text-orange-600 hover:text-orange-800 hover:bg-orange-50 px-2 py-1 rounded transition-colors disabled:opacity-40"
                      >
                        <PowerOff className="h-3 w-3" />
                        <span>Désactiver</span>
                      </button>

                      {/* Modifier + Réinitialiser — 1 seul sélectionné */}
                      {selectedUsernames.size === 1 && (() => {
                        const username = [...selectedUsernames][0];
                        const selUser = filtered.find((u) => u.username === username) ?? ({ username } as HotspotUser);
                        return (
                          <>
                            <div className="h-4 w-px bg-blue-200 flex-shrink-0" />
                            <button
                              type="button"
                              onClick={() => openEditUser(selUser)}
                              disabled={isSavingRename}
                              className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 px-2 py-1 rounded transition-colors disabled:opacity-40"
                            >
                              <Pencil className="h-3 w-3" />
                              <span>Modifier</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmResetUser(selUser)}
                              disabled={isResetting}
                              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-2 py-1 rounded transition-colors disabled:opacity-40"
                            >
                              <RotateCcw className="h-3 w-3" />
                              <span>Réinitialiser</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => openExtendUser(selUser)}
                              disabled={isExtending}
                              className="flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 px-2 py-1 rounded transition-colors disabled:opacity-40"
                            >
                              <CalendarPlus className="h-3 w-3" />
                              <span>Prolonger</span>
                            </button>
                          </>
                        );
                      })()}

                      <div className="h-4 w-px bg-blue-200 flex-shrink-0 ml-auto" />

                      {/* Supprimer — poussé à droite */}
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteSelected(true)}
                        className="flex items-center gap-1 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded transition-colors"
                      >
                        <Trash2 className="h-3 w-3" />
                        <span>Supprimer</span>
                        <span className="ml-0.5 bg-red-100 text-red-600 font-bold px-1 rounded tabular-nums">
                          {selectedUsernames.size}
                        </span>
                      </button>
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
              <AlertDialog open={confirmDeleteSelected} onOpenChange={(open) => { if (!isDeletingSelected) setConfirmDeleteSelected(open); }}>
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
                    <AlertDialogCancel disabled={isDeletingSelected}>Annuler</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDeleteSelected}
                      disabled={isDeletingSelected}
                      className="bg-red-600 hover:bg-red-700"
                    >
                      {isDeletingSelected
                        ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />Suppression...</>
                        : "Supprimer définitivement"}
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
                    <div className="py-12 px-4 text-center flex flex-col items-center justify-center">
                      <RefreshCw className="h-8 w-8 text-gray-300 mb-3 animate-spin" />
                      <p className="text-sm font-medium text-gray-400">Chargement depuis MikroTik…</p>
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
                          onExtend={() => openExtendUser(user)}
                          onCopy={() => { void navigator.clipboard.writeText(user.username); }}
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
                    <div className="flex flex-nowrap items-center gap-1.5">
                      <div className="relative flex-1 min-w-0">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                        <Input
                          className="pl-8 h-8 text-[11px] min-w-0"
                          placeholder="Rechercher un lot..."
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
                            className={`flex-1 min-w-0 justify-between font-normal text-[11px] h-8 px-1.5 ${lotsFilterVendor !== "all" ? "border-blue-400 text-blue-700 bg-blue-50" : ""}`}
                          >
                            <span className="truncate">
                              {lotsFilterVendor === "all"
                                ? <><span className="md:hidden">Vendeurs</span><span className="hidden md:inline">Tous les vendeurs</span></>
                                : lotsFilterVendor}
                            </span>
                            <ChevronsUpDown className="ml-1 h-3.5 w-3.5 text-gray-400 shrink-0 opacity-50" />
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
                            className={`flex-1 min-w-0 justify-between font-normal text-[11px] h-8 px-1.5 ${lotsFilterProfile !== "all" ? "border-blue-400 text-blue-700 bg-blue-50" : ""}`}
                          >
                            <span className="truncate">
                              {lotsFilterProfile === "all"
                                ? <><span className="md:hidden">Forfaits</span><span className="hidden md:inline">Tous les forfaits</span></>
                                : lotsFilterProfile}
                            </span>
                            <ChevronsUpDown className="ml-1 h-3.5 w-3.5 text-gray-400 shrink-0 opacity-50" />
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
                            {sortedProfiles.map((profile) => profile.name).map((p) => (
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
                          className="shrink-0 text-gray-400 hover:text-gray-600 h-8 px-2 text-[11px]"
                        >
                          Réinitialiser
                        </Button>
                      )}

                      <span className="text-[11px] text-gray-400 shrink-0 whitespace-nowrap">
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
                  <CardContent className="py-12 px-4 text-center flex flex-col items-center justify-center">
                    <RefreshCw className="h-8 w-8 text-gray-300 mb-3 animate-spin" />
                    <p className="text-sm font-medium text-gray-400">Chargement depuis MikroTik…</p>
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
                      <div className="flex items-center justify-between px-3 py-2 sm:px-5 sm:py-4 gap-2">
                        {/* Info lot */}
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <Package className="h-4 w-4 sm:h-5 sm:w-5 text-blue-400 flex-shrink-0" />
                          <div className="min-w-0 flex-1">
                            {/* Nom sur une seule ligne, tronqué sur mobile */}
                            <p className="font-mono font-semibold text-gray-900 text-sm truncate sm:break-all">
                              {lot.name}
                            </p>
                            {/* Méta : count · profil · vendeur — une seule ligne sur mobile */}
                            <div className="flex flex-nowrap items-center gap-1 mt-0.5 overflow-hidden sm:flex-wrap sm:gap-2">
                              <span className="text-xs font-semibold text-green-500/70 flex-shrink-0 whitespace-nowrap">
                                {lot.count} ticket{lot.count !== 1 ? "s" : ""}
                              </span>
                              {lot.profile && (
                                <>
                                  <span className="text-gray-300 flex-shrink-0">·</span>
                                  <span className="text-xs font-medium text-amber-600/70 truncate">{lot.profile}</span>
                                </>
                              )}
                              {canonicalVendorFromLot(lot.name) && (
                                <>
                                  <span className="text-gray-300 flex-shrink-0">·</span>
                                  <span className="text-xs font-medium text-blue-600/70 bg-blue-50/70 px-1 py-0.5 rounded flex-shrink-0 whitespace-nowrap">
                                    {canonicalVendorFromLot(lot.name)}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Boutons — icônes seules sur mobile, libellés sur sm+ */}
                        <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 w-7 p-0 sm:h-auto sm:w-auto sm:px-2.5 sm:gap-1.5 sm:text-xs text-blue-600 border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                            onClick={() => handlePrintLot(lot)}
                            disabled={printingLot === lot.name}
                            title="Imprimer les tickets de ce lot"
                          >
                            {printingLot === lot.name
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Printer className="h-3.5 w-3.5" />}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 w-7 p-0 sm:h-auto sm:w-auto sm:px-2.5 sm:gap-1.5 sm:text-xs"
                            onClick={() => handleExportTxt(lot)}
                            title="Exporter en .txt"
                          >
                            <FileText className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">.txt</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 w-7 p-0 sm:h-auto sm:w-auto sm:px-2.5 sm:gap-1.5 sm:text-xs"
                            onClick={() => handleExportCsv(lot)}
                            title="Exporter en .csv"
                          >
                            <Table2 className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">.csv</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 sm:h-auto sm:w-auto sm:px-2.5 sm:gap-1.5 sm:text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => setDeletingLot(lot.name)}
                            disabled={isDeletingLot}
                            title="Supprimer ce lot de MikroTik"
                          >
                            {isDeletingLot && deletingLotName === lot.name
                              ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                              : <Trash2 className="h-3.5 w-3.5" />}
                          </Button>
                        </div>
                      </div>

                      {/* Preview: first 4 vouchers */}
                      <div className="border-t border-gray-100 bg-gray-50 px-3 py-1 sm:px-5 sm:py-2 flex flex-wrap gap-2 sm:gap-3">
                        {lot.preview.map((u) => (
                          <span key={u.username} className="font-mono text-xs text-gray-500">
                            {u.username}
                          </span>
                        ))}
                        {lot.count > 4 && (
                          <span className="text-xs text-gray-400">+{lot.count - 4} autres</span>
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

      {/* Prolonger dialog */}
      <Dialog open={!!extendUser} onOpenChange={(o) => { if (!o && !isExtending) setExtendUser(null); }}>
        <DialogContent className="max-w-sm gap-0 overflow-hidden p-0 [&>button]:hidden">
          <div className="border-b bg-muted/30 px-6 py-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CalendarPlus className="h-4 w-4 text-blue-600" />
                Prolonger le forfait
              </DialogTitle>
            </DialogHeader>
            {extendUser && (
              <p className="mt-1 text-xs text-muted-foreground font-mono">{extendUser.username}</p>
            )}
          </div>
          <div className="px-6 py-5 space-y-4">
            {extendUser && (() => {
              const expDate = parseExpirationDate(extendUser.comment);
              const alreadyExpired = !expDate || expDate.getTime() <= Date.now();
              return (
                <>
                  <div className="text-xs text-muted-foreground">
                    <p>
                      Expiration actuelle :{" "}
                      {expDate
                        ? <span className="font-mono text-foreground">{expDate.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                        : <span className="italic">aucune date</span>}
                    </p>
                  </div>
                  {alreadyExpired && (
                    <div className="flex items-start gap-2 rounded-md bg-orange-50 border border-orange-200 px-3 py-2 text-xs text-orange-700">
                      <RotateCcw className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                      <span>Forfait expiré — le compte sera <strong>réinitialisé</strong> (compteurs remis à zéro, session coupée) avant d'appliquer la nouvelle date.</span>
                    </div>
                  )}
                </>
              );
            })()}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Durée à ajouter</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min="1"
                  max="999"
                  value={extendAmount}
                  onChange={(e) => setExtendAmount(e.target.value)}
                  disabled={isExtending}
                  className="flex-1 font-mono text-center text-base"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") void handleExtend(); }}
                />
                <select
                  value={extendUnit}
                  onChange={(e) => setExtendUnit(e.target.value as "Heure" | "Jour" | "Mois")}
                  disabled={isExtending}
                  className="flex h-9 w-28 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="Heure">Heure(s)</option>
                  <option value="Jour">Jour(s)</option>
                  <option value="Mois">Mois</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => setExtendUser(null)}
                disabled={isExtending}
              >
                Annuler
              </Button>
              <Button
                type="button"
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
                onClick={() => void handleExtend()}
                disabled={isExtending || !extendAmount || parseInt(extendAmount, 10) <= 0}
              >
                {isExtending
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> En cours…</>
                  : <><CalendarPlus className="h-4 w-4" /> Prolonger</>}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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

      {/* Edit user dialog — thème app + actions icônes (ordre : Fermer / Enregistrer / Activer·Désactiver / Supprimer / Réinitialiser) */}
      <Dialog open={!!editingUser} onOpenChange={(o) => { if (!o && !isSavingRename && !isTogglingEditUserDisabled) setEditingUser(null); }}>
        <DialogContent className="max-w-md gap-0 overflow-hidden p-0 sm:max-w-md [&>button]:hidden">
          <div className="space-y-1.5 border-b bg-muted/30 px-6 py-4">
            <DialogHeader className="space-y-1.5 text-left">
              <DialogTitle>{"Modifier l'utilisateur"}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => setEditingUser(null)}
                    disabled={isSavingRename || isTogglingEditUserDisabled}
                    aria-label="Fermer"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Fermer</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="default"
                    className="shrink-0"
                    onClick={() => void handleRenameUser()}
                    disabled={
                      isSavingRename ||
                      isTogglingEditUserDisabled ||
                      !editUsername.trim() ||
                      !editPassword.trim() ||
                      !editProfile.trim() ||
                      (linkBypass && !editBypassMac.trim() && !editBypassComment.trim())
                    }
                    aria-label="Enregistrer"
                  >
                    {isSavingRename ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Enregistrer</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className={
                      editingUser?.disabled
                        ? "shrink-0 text-green-600 hover:bg-green-50 hover:text-green-800 dark:hover:bg-green-950/40"
                        : "shrink-0 text-orange-600 hover:bg-orange-50 hover:text-orange-800 dark:hover:bg-orange-950/40"
                    }
                    disabled={isSavingRename || isTogglingEditUserDisabled || !editingUser || !activeRouterId}
                    onClick={() => void handleToggleEditUserDisabled()}
                    aria-label={editingUser?.disabled ? "Activer" : "Désactiver"}
                  >
                    {isTogglingEditUserDisabled ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : editingUser?.disabled ? (
                      <Power className="h-4 w-4" />
                    ) : (
                      <PowerOff className="h-4 w-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{editingUser?.disabled ? "Activer" : "Désactiver"}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={isSavingRename || isTogglingEditUserDisabled || !editingUser}
                    onClick={() => {
                      if (!editingUser) return;
                      const u = editingUser;
                      setEditingUser(null);
                      setConfirmDeleteEditUser(u);
                    }}
                    aria-label="Supprimer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Supprimer</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="shrink-0 text-orange-600 hover:bg-orange-50 hover:text-orange-700 dark:hover:bg-orange-950/40"
                    disabled={isSavingRename || isTogglingEditUserDisabled || !editingUser}
                    onClick={() => {
                      if (!editingUser) return;
                      const u = editingUser;
                      setEditingUser(null);
                      setConfirmResetUser(u);
                    }}
                    aria-label="Réinitialiser"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Réinitialiser</TooltipContent>
              </Tooltip>
            </div>
          </div>
          <div className="max-h-[min(70vh,28rem)] space-y-3 overflow-y-auto px-6 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-username" className="text-xs text-muted-foreground">Identifiant</Label>
              <Input
                id="edit-username"
                value={editUsername}
                onChange={(e) => setEditUsername(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void handleRenameUser(); }}
                placeholder="Code ou nom d'utilisateur"
                className="font-mono"
                autoFocus
                disabled={isSavingRename || isTogglingEditUserDisabled}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-password" className="text-xs text-muted-foreground">Mot de passe</Label>
              <PasswordInput
                id="edit-password"
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
                className="font-mono"
                disabled={isSavingRename || isTogglingEditUserDisabled}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-profile" className="text-xs text-muted-foreground">Forfait (profil)</Label>
              <select
                id="edit-profile"
                className={cn(
                  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm",
                  "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
                value={editProfile}
                onChange={(e) => setEditProfile(e.target.value)}
                disabled={isSavingRename || isTogglingEditUserDisabled}
              >
                <option value="">Choisir un forfait</option>
                {sortedProfiles.map((p) => (
                  <option key={p.name} value={p.name}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 pt-0.5">
              <input
                id="link-bypass"
                type="checkbox"
                className="h-4 w-4 rounded border-input"
                checked={linkBypass}
                onChange={(e) => setLinkBypass(e.target.checked)}
                disabled={isSavingRename || isTogglingEditUserDisabled}
              />
              <Label htmlFor="link-bypass" className="text-sm font-normal text-muted-foreground">
                Lier un bypass MAC automatique
              </Label>
            </div>
            {linkBypass && (
              <div className="space-y-3 border-t pt-3">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-bypass-comment" className="text-xs text-muted-foreground">Recherche bypass (commentaire)</Label>
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
                    placeholder="Filtrer par commentaire du bypass…"
                    disabled={isSavingRename || isTogglingEditUserDisabled}
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
                  <Label htmlFor="edit-bypass-mac" className="text-xs text-muted-foreground">Adresse MAC du bypass</Label>
                  <Input
                    id="edit-bypass-mac"
                    value={editBypassMac}
                    onChange={(e) => setEditBypassMac(e.target.value)}
                    placeholder="AA:BB:CC:DD:EE:FF"
                    className="font-mono"
                    disabled={isSavingRename || isTogglingEditUserDisabled}
                  />
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDeleteEditUser} onOpenChange={(o) => { if (!o && !isDeletingEditUser) setConfirmDeleteEditUser(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce voucher&nbsp;?</AlertDialogTitle>
            <AlertDialogDescription>
              L&apos;utilisateur{" "}
              <span className="font-mono font-semibold">{confirmDeleteEditUser?.username}</span>{" "}
              sera définitivement supprimé de MikroTik. Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingEditUser}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeletingEditUser}
              onClick={() => void handleConfirmDeleteEditUser()}
            >
              {isDeletingEditUser ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Suppression…
                </>
              ) : (
                "Supprimer"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Add User dialog (Mikhmon-style compact) ─────────────────────── */}
      <Dialog open={addUserOpen} onOpenChange={(o) => {
        if (!isSavingUser && !addEditLoading) {
          if (!o) { resetAddUserForm(); }
          setAddUserOpen(o);
        }
      }}>
        <DialogContent className="w-[95vw] sm:max-w-md p-0 overflow-hidden bg-slate-700 text-slate-100 border-slate-600 sm:rounded-md max-h-[90vh]">
          <DialogHeader className="px-3 pt-2 pb-1.5 border-b border-slate-600 bg-slate-700">
            <DialogTitle className="text-sm font-semibold flex items-center gap-1.5 text-slate-100">
              {addDialogMode === "recap"
                ? <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /><span className="truncate">Client ajouté — {addEditOriginalName}</span></>
                : addDialogMode === "edit"
                ? <><Pencil className="h-3.5 w-3.5 text-cyan-400" /><span className="truncate">Modifier — {addEditOriginalName}</span></>
                : <><UserPlus className="h-3.5 w-3.5" /> Ajouter un client</>}
            </DialogTitle>
          </DialogHeader>

          {/* ── Buttons bar ── */}
          <div className="flex items-center gap-2 px-3 pt-2 pb-2 bg-slate-700">
            <Button type="button" size="sm"
              onClick={() => { resetAddUserForm(); setAddUserOpen(false); }}
              disabled={isSavingUser || addEditLoading}
              className="h-7 text-xs bg-amber-500 hover:bg-amber-600 text-white gap-1 px-2.5">
              <X className="h-3 w-3" /> Fermer
            </Button>
            {(addDialogMode === "edit" || addDialogMode === "recap") && (
              <Button type="button" size="sm"
                onClick={() => { resetAddUserForm(); }}
                disabled={addEditLoading}
                className="h-7 text-xs bg-slate-500 hover:bg-slate-400 text-white gap-1 px-2.5">
                <FilePlus2 className="h-3 w-3" /> Nouveau
              </Button>
            )}
            {addDialogMode === "recap" && (
              <Button type="button" size="sm"
                onClick={() => setAddDialogMode("edit")}
                className="h-7 text-xs bg-indigo-600 hover:bg-indigo-500 text-white gap-1 px-2.5">
                <Pencil className="h-3 w-3" /> Modifier
              </Button>
            )}
            {addDialogMode !== "recap" && (
              <Button type="button" size="sm"
                onClick={() => void (addDialogMode === "edit" ? handleEditSavedUser() : handleSaveUser())}
                disabled={isSavingUser || addEditLoading}
                className="h-7 text-xs bg-cyan-500 hover:bg-cyan-600 text-white gap-1 px-2.5">
                {(isSavingUser || addEditLoading) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                Enregistrer
              </Button>
            )}
          </div>

          {/* ── RECAP card (mode recap seulement) ── */}
          {addDialogMode === "recap" && addRecapUser && (
            <div className="px-3 pb-4 pt-2 bg-slate-700 overflow-y-auto space-y-2">
              <div className="bg-slate-800 rounded-lg border border-slate-600 divide-y divide-slate-600 text-xs overflow-hidden">
                <div className="grid grid-cols-[76px_1fr] px-3 py-2 items-center">
                  <span className="text-slate-400">Name</span>
                  <span className="font-mono font-semibold text-slate-100 truncate">{addRecapUser.name}</span>
                </div>
                <div className="grid grid-cols-[76px_1fr] px-3 py-2 items-center">
                  <span className="text-slate-400">Password</span>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-mono text-slate-100 truncate">{addShowPassword ? addRecapUser.password : "••••••••"}</span>
                    <button type="button" onClick={() => setAddShowPassword((v) => !v)}
                      className="h-5 w-5 flex-shrink-0 flex items-center justify-center rounded bg-slate-600 hover:bg-slate-500 text-slate-300">
                      {addShowPassword ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-[76px_1fr] px-3 py-2 items-center">
                  <span className="text-slate-400">Profile</span>
                  <span className="text-cyan-300 font-medium truncate">{addRecapUser.profile}</span>
                </div>
                {addRecapUser.server !== "all" && addRecapUser.server && (
                  <div className="grid grid-cols-[76px_1fr] px-3 py-2 items-center">
                    <span className="text-slate-400">Server</span>
                    <span className="text-slate-100 truncate">{addRecapUser.server}</span>
                  </div>
                )}
                {addRecapUser.limitUptime && (
                  <div className="grid grid-cols-[76px_1fr] px-3 py-2 items-center">
                    <span className="text-slate-400">Time Limit</span>
                    <span className="font-mono text-slate-100">{addRecapUser.limitUptime}</span>
                  </div>
                )}
                {addRecapUser.limitBytes && (
                  <div className="grid grid-cols-[76px_1fr] px-3 py-2 items-center">
                    <span className="text-slate-400">Data Limit</span>
                    <span className="font-mono text-slate-100">{(parseInt(addRecapUser.limitBytes) / 1048576).toFixed(1)} MB</span>
                  </div>
                )}
                {addRecapUser.comment && (
                  <div className="grid grid-cols-[76px_1fr] px-3 py-2 items-center">
                    <span className="text-slate-400">Comment</span>
                    <span className="font-mono text-slate-100 truncate">{addRecapUser.comment}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className={`px-3 pb-3 space-y-1.5 bg-slate-700 overflow-y-auto${addDialogMode === "recap" ? " hidden" : ""}`}>

            {/* ── EDIT mode — success banner ── */}
            {addDialogMode === "edit" && (
              <p className="text-xs text-emerald-300 bg-emerald-900/30 border border-emerald-700 rounded px-2 py-1.5">
                ✓ Utilisateur créé. Modifiez les champs si besoin, puis Enregistrer.
              </p>
            )}

            {/* Server */}
            <div className="grid grid-cols-[68px_1fr] items-center gap-2">
              <Label className="text-xs text-slate-300 font-normal">Server</Label>
              <Popover open={addServerPopoverOpen} onOpenChange={setAddServerPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox"
                    disabled={isSavingUser || addEditLoading || addDialogMode === "edit"}
                    className="h-8 w-full justify-between text-xs font-normal bg-slate-600 border-slate-500 text-slate-100 hover:bg-slate-500 hover:text-white px-2 disabled:opacity-40">
                    <span className="truncate">{addServer || "all"}</span>
                    <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-70" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-1" align="start">
                  <button type="button" onClick={() => { setAddServer("all"); setAddServerPopoverOpen(false); }}
                    className="flex w-full items-center gap-2 px-2 py-1 text-xs rounded hover:bg-gray-100 text-left">
                    <Check className={`h-3 w-3 ${addServer === "all" ? "opacity-100 text-blue-600" : "opacity-0"}`} />
                    all
                  </button>
                </PopoverContent>
              </Popover>
            </div>

            {/* Name */}
            <div className="grid grid-cols-[68px_1fr] items-center gap-2">
              <Label className="text-xs text-slate-300 font-normal">Name</Label>
              <Input value={addName} onChange={(e) => setAddName(e.target.value)}
                disabled={isSavingUser || addEditLoading}
                className="h-8 text-xs bg-slate-600 border-slate-500 text-slate-100 placeholder:text-slate-400 focus-visible:ring-cyan-500"
                autoComplete="off" />
            </div>

            {/* Password */}
            <div className="grid grid-cols-[68px_1fr] items-center gap-2">
              <Label className="text-xs text-slate-300 font-normal">Password</Label>
              <PasswordInput
                value={addPassword}
                onChange={(e) => setAddPassword(e.target.value)}
                disabled={isSavingUser || addEditLoading}
                className="h-8 text-xs bg-slate-600 border-slate-500 text-slate-100 placeholder:text-slate-400 focus-visible:ring-cyan-500"
                buttonClassName="text-slate-300 hover:text-white"
                autoComplete="new-password"
              />
            </div>

            {/* Profile */}
            <div className="grid grid-cols-[68px_1fr] items-center gap-2">
              <Label className="text-xs text-slate-300 font-normal">Profile</Label>
              <Popover open={addProfilePopoverOpen} onOpenChange={setAddProfilePopoverOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox"
                    disabled={isSavingUser || addEditLoading}
                    className="h-8 w-full justify-between text-xs font-normal bg-slate-600 border-slate-500 text-slate-100 hover:bg-slate-500 hover:text-white px-2">
                    <span className="truncate">{addProfile || "—"}</span>
                    <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-70" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-1 max-h-56 overflow-y-auto" align="start">
                  {sortedProfiles.length === 0 && (
                    <p className="px-2 py-1 text-xs text-gray-400">Aucun profil disponible.</p>
                  )}
                  {sortedProfiles.map((p) => (
                    <button key={p.name} type="button"
                      onClick={() => {
                        setAddProfile(p.name);
                        setAddProfilePopoverOpen(false);
                        setAddComment(makeClientBatchId(p.validity ? "vc" : "up"));
                      }}
                      className="flex w-full items-center gap-2 px-2 py-1 text-xs rounded hover:bg-gray-100 text-left">
                      <Check className={`h-3 w-3 ${addProfile === p.name ? "opacity-100 text-blue-600" : "opacity-0"}`} />
                      <span className="truncate">{p.name}</span>
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            </div>

            {/* Time Limit */}
            <div className="grid grid-cols-[68px_1fr] items-center gap-2">
              <Label className="text-xs text-slate-300 font-normal">Time Limit</Label>
              <Input value={addTimeLimit} onChange={(e) => setAddTimeLimit(e.target.value)}
                disabled={isSavingUser || addEditLoading || addDialogMode === "edit"}
                placeholder="30d, 12h, 4w3d"
                className="h-8 text-xs bg-slate-600 border-slate-500 text-slate-100 placeholder:text-slate-400 focus-visible:ring-cyan-500 disabled:opacity-40" />
            </div>

            {/* Data Limit */}
            <div className="grid grid-cols-[68px_1fr] items-center gap-2">
              <Label className="text-xs text-slate-300 font-normal">Data Limit</Label>
              <div className="flex gap-1.5">
                <Input type="number" min="0" value={addDataLimit} onChange={(e) => setAddDataLimit(e.target.value)}
                  disabled={isSavingUser || addEditLoading || addDialogMode === "edit"}
                  className="h-8 text-xs flex-1 bg-slate-600 border-slate-500 text-slate-100 placeholder:text-slate-400 focus-visible:ring-cyan-500 disabled:opacity-40" />
                <Popover open={addUnitPopoverOpen} onOpenChange={setAddUnitPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox"
                      disabled={isSavingUser || addEditLoading || addDialogMode === "edit"}
                      className="h-8 w-16 justify-between text-xs font-normal bg-slate-600 border-slate-500 text-slate-100 hover:bg-slate-500 hover:text-white px-2 disabled:opacity-40">
                      {addDataUnit}
                      <ChevronsUpDown className="h-3 w-3 opacity-70" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-16 p-1" align="end">
                    {(["MB", "GB"] as const).map((u) => (
                      <button key={u} type="button" onClick={() => { setAddDataUnit(u); setAddUnitPopoverOpen(false); }}
                        className="flex w-full items-center gap-1.5 px-2 py-1 text-xs rounded hover:bg-gray-100 text-left">
                        <Check className={`h-3 w-3 ${addDataUnit === u ? "opacity-100 text-blue-600" : "opacity-0"}`} />
                        {u}
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Comment */}
            <div className="grid grid-cols-[68px_1fr] items-center gap-2">
              <Label className="text-xs text-slate-300 font-normal">Comment</Label>
              <Input value={addComment} onChange={(e) => setAddComment(e.target.value)}
                disabled={isSavingUser || addEditLoading || addDialogMode === "edit"}
                className="h-8 text-xs bg-slate-600 border-slate-500 text-slate-100 placeholder:text-slate-400 focus-visible:ring-cyan-500 disabled:opacity-40" />
            </div>

          </div>
        </DialogContent>
      </Dialog>

      {/* Delete lot confirmation */}
      <AlertDialog open={!!deletingLot} onOpenChange={(o) => { if (!o && !isDeletingLot) setDeletingLot(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer le lot ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le lot <strong className="font-mono">{deletingLot}</strong> et tous ses vouchers seront
              définitivement supprimés de MikroTik. Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingLot}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deletingLot && handleDeleteLot(deletingLot)}
              disabled={isDeletingLot}
            >
              {isDeletingLot
                ? <span className="inline-flex items-center gap-1.5"><RefreshCw className="h-3.5 w-3.5 animate-spin" />Suppression...</span>
                : "Supprimer"}
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

// Format a Date as MikroTik hotspot comment date: "mmm/dd/yyyy HH:mm:ss"
const MK_MONTHS_OUT = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
function formatMikrotikDate(d: Date): string {
  const mon = MK_MONTHS_OUT[d.getMonth()];
  const day = String(d.getDate()).padStart(2, "0");
  const yr = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${mon}/${day}/${yr} ${hh}:${mm}:${ss}`;
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
  onExtend,
  onCopy,
}: {
  user: HotspotUser;
  isExpired: boolean;
  selected: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onReset: () => void;
  onExtend: () => void;
  onCopy: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onEdit();
        }
      }}
      className={`flex items-center justify-between px-3 sm:px-4 py-3 hover:bg-gray-50 group cursor-pointer ${selected ? "bg-blue-50" : ""}`}
    >
      <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          onClick={(e) => e.stopPropagation()}
          className="h-4 w-4 rounded flex-shrink-0"
        />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onEdit}
              className="font-mono font-semibold text-sm text-left hover:text-blue-600 hover:underline underline-offset-2"
              title="Modifier cet utilisateur"
            >
              {user.username}
            </button>
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
            onClick={(e) => { e.stopPropagation(); onCopy(); }}
            className="gap-2 cursor-pointer"
          >
            <Copy className="h-3.5 w-3.5" />
            Copier le code
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            className="gap-2 cursor-pointer"
          >
            <Pencil className="h-3.5 w-3.5" />
            Modifier utilisateur
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => { e.stopPropagation(); onExtend(); }}
            className="gap-2 cursor-pointer text-emerald-600 focus:text-emerald-600"
          >
            <CalendarPlus className="h-3.5 w-3.5" />
            Prolonger
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
