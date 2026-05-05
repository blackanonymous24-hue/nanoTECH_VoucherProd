import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Router, Ticket, Zap, Wifi,
  PackageOpen, Activity, Users, BarChart3, FileCode, LogOut,
  UserCog, Menu, X, Receipt, ListOrdered, Wallet, KeyRound, CheckCircle2, Bell, Wrench, CreditCard, UserPlus, SearchCheck, ShieldCheck, Crown, Database, Cookie, ChevronDown,
  Eye, EyeOff, ChevronsUpDown, Check, Save, Loader2, Pencil, FilePlus2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useRouterContext } from "@/contexts/RouterContext";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAppNavigate } from "@/hooks/use-app-navigate";
import { sortRouterProfilesByCreationOrder } from "@/lib/routerProfilesSort";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PasswordInput } from "@/components/ui/password-input";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function RouterSelector({ className, compact }: { className?: string; compact?: boolean }) {
  const { selectedRouterId, setSelectedRouterId, routers, routersLoading, routerOnline, selectedRouter, isRouterLocked } = useRouterContext();

  return (
    <div className={cn("flex items-center gap-2 min-w-0", className)}>
      {isRouterLocked ? (
        <div className="flex items-center gap-1.5 h-8 px-2.5 rounded-md bg-white/5 border border-white/10 text-xs text-gray-200 min-w-0 flex-1">
          <Router className="h-3 w-3 text-gray-400 flex-shrink-0" />
          <span className="truncate">{selectedRouter?.name ?? "Routeur assigné"}</span>
          <span className="ml-0.5 text-[9px] text-amber-400 font-medium flex-shrink-0">🔒</span>
        </div>
      ) : routersLoading && routers.length === 0 ? (
        <div className="h-8 w-32 bg-white/5 rounded-md animate-pulse flex-1" />
      ) : (
        <Select
          value={selectedRouterId ? String(selectedRouterId) : ""}
          onValueChange={(v) => setSelectedRouterId(v ? parseInt(v, 10) : null)}
          disabled={routers.length === 0}
        >
          <SelectTrigger className={cn(
            "h-8 text-xs bg-white/5 border-white/10 text-gray-200 hover:bg-white/10 focus:ring-0 focus:ring-offset-0 disabled:opacity-40 transition-colors min-w-0",
            compact ? "w-full" : "w-full",
          )}>
            <SelectValue placeholder="Routeur..." />
          </SelectTrigger>
          <SelectContent className="bg-[#161b27] border-white/10 text-gray-200">
            {routers.map((r) => (
              <SelectItem key={r.id} value={String(r.id)} className="text-xs focus:bg-white/10 focus:text-white">{r.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {selectedRouterId && (
        <span className="relative flex h-2 w-2 flex-shrink-0">
          {routerOnline === true ? (
            <>
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </>
          ) : routerOnline === false ? (
            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
          ) : null}
        </span>
      )}
    </div>
  );
}

function makeClientBatchId(mode: "vc" | "up"): string {
  const now = new Date();
  const M = String(now.getMonth() + 1).padStart(2, "0");
  const D = String(now.getDate()).padStart(2, "0");
  const Y = String(now.getFullYear()).slice(-2);
  const rand = String(Math.floor(Math.random() * 900) + 100);
  return `${mode}-${rand}-${M}.${D}.${Y}`;
}

function NavContent({ onNavigate, mobileDrawer }: { onNavigate?: () => void; mobileDrawer?: boolean }) {
  const [location] = useLocation();
  const { routerIdentity, selectedRouterId } = useRouterContext();
  const { logout, role, token, isSuperAdmin } = useAuth();
  const appNavigate = useAppNavigate();

  const handleLogout = () => {
    logout();
    appNavigate("/admin");
  };
  const isAdmin = role === "admin";
  const isManager = role === "manager";
  const isCollaborateur = role === "collaborateur";
  /* ── Hotspot collapsible (sous-section dans Réseau) ── */
  const hotspotPaths = ["/sessions", "/ip-bindings", "/dhcp-leases", "/hotspot-cookies"];
  const isHotspotPage = hotspotPaths.some((p) => location.startsWith(p));
  const [hotspotOpen, setHotspotOpen] = useState(() => isHotspotPage);
  useEffect(() => { if (isHotspotPage) setHotspotOpen(true); }, [isHotspotPage]);
  /* ── Vendeurs collapsible (sous-section dans Tickets) ── */
  const vendorNavPaths = ["/vendors"];
  const isVendorPage = vendorNavPaths.some((p) => location.startsWith(p));
  const [vendorsOpen, setVendorsOpen] = useState(() => isVendorPage);
  useEffect(() => { if (isVendorPage) setVendorsOpen(true); }, [isVendorPage]);
  /* ── Vendor count — masquer les items vendeur si aucun vendeur sur ce routeur ── */
  const { data: vendorsList } = useQuery<{ id: number }[]>({
    queryKey: ["vendors-nav-count", selectedRouterId],
    queryFn: async ({ signal }) => {
      if (!selectedRouterId) return [];
      const res = await fetch(`${BASE}/api/vendors?routerId=${selectedRouterId}`, { signal });
      if (!res.ok) return [];
      const data: unknown = await res.json();
      return Array.isArray(data) ? (data as { id: number }[]) : [];
    },
    staleTime: 60_000,
    retry: 1,
  });
  // undefined = chargement en cours → on affiche par défaut pour éviter le flash
  const hasVendors = selectedRouterId
    ? (vendorsList === undefined || vendorsList.length > 0)
    : false;
  const isVouchersPage = location.startsWith("/vouchers");

  const isNavActive = (href: string) => {
    // Keep vendor-related pages independent in sidebar highlighting.
    const exactOnly = new Set([
      "/vendors",
      "/vendors/tracking",
      "/vendors/versement-du-jour",
      "/vendors/versements",
    ]);
    if (href === "/") return location === "/";
    if (exactOnly.has(href)) return location === href;
    return location.startsWith(href);
  };

  const handleTabClick = (href: string, e: React.MouseEvent) => {
    const isCurrentPage = isNavActive(href);
    if (isCurrentPage) {
      e.preventDefault();
      window.location.reload();
      return;
    }
    onNavigate?.();
  };

  /* ── Low-stock alert: per-vendor per-profile granularity ── */
  const { data: stockAlerts } = useQuery<{
    count: number;
    alerts: { vendorId: number | null; vendorName: string; profileName: string; available: number }[];
  }>({
    queryKey: ["stock-alerts", selectedRouterId],
    queryFn: async ({ signal }) => {
      const params = selectedRouterId ? `?routerId=${selectedRouterId}` : "";
      const res = await fetch(`${BASE}/api/vendors/stock-alerts${params}`, { signal });
      if (!res.ok) throw new Error("stock-alerts failed");
      return res.json() as Promise<{ count: number; alerts: { vendorId: number | null; vendorName: string; profileName: string; available: number }[] }>;
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
    retry: 2,
  });
  const lowStockCount = stockAlerts?.count ?? 0;

  /* ── Password change dialog state (managers only) ── */
  const [showPwd, setShowPwd]     = useState(false);
  const [pwdNew, setPwdNew]       = useState("");
  const [pwdError, setPwdError]   = useState("");
  const [pwdSuccess, setPwdSuccess] = useState(false);
  const [pwdLoading, setPwdLoading] = useState(false);

  /* ── Add hotspot user dialog state (admin + manager) ── */
  const [showAddUser, setShowAddUser]           = useState(false);
  const [addName, setAddName]                   = useState("");
  const [addPassword, setAddPassword]           = useState("");
  const [addShowPassword, setAddShowPassword]   = useState(false);
  const [addServer, setAddServer]               = useState("all");
  const [addProfile, setAddProfile]             = useState("");
  const [addComment, setAddComment]             = useState("");
  const [addLimitUptime, setAddLimitUptime]     = useState("");
  const [addLimitBytes, setAddLimitBytes]       = useState("");
  const [addLimitBytesUnit, setAddLimitBytesUnit] = useState<"MB" | "GB">("MB");
  const [addMac, setAddMac]                     = useState("");
  const [addError, setAddError]                 = useState("");
  const [addLoading, setAddLoading]             = useState(false);
  const [addDialogMode, setAddDialogMode]       = useState<"create" | "edit" | "recap">("create");
  const [addEditOriginalName, setAddEditOriginalName] = useState("");
  const [addEditLoading, setAddEditLoading]     = useState(false);
  const [addRecapUser, setAddRecapUser]         = useState<{ name: string; password: string; profile: string; server: string; limitUptime: string; limitBytes: string; comment: string } | null>(null);

  /* Profile list for the selected router (fetched when dialog opens) */
  const { data: dialogProfiles } = useQuery<
    { name: string; price: string | null; validity: string | null; schedulerMonitorActive: boolean }[]
  >({
    queryKey: ["router-profiles-dialog", selectedRouterId],
    queryFn: async ({ signal }) => {
      if (!selectedRouterId) return [];
      const res = await fetch(`${BASE}/api/routers/${selectedRouterId}/profiles`, { signal });
      if (!res.ok) return [];
      const data = await res.json() as {
        name: string;
        mikrotikId?: string;
        price?: string;
        validity?: string;
        schedulerMonitorActive?: boolean;
      }[];
      const sorted = sortRouterProfilesByCreationOrder(data);
      return sorted.map((p) => ({
        name: p.name,
        price: p.price ?? null,
        validity: p.validity ?? null,
        schedulerMonitorActive: p.schedulerMonitorActive === true,
      }));
    },
    enabled: showAddUser && !!selectedRouterId,
    staleTime: 60_000,
  });
  const { data: dialogServers } = useQuery<{ name: string; disabled?: boolean }[]>({
    queryKey: ["router-hotspot-servers-dialog", selectedRouterId],
    queryFn: async ({ signal }) => {
      if (!selectedRouterId) return [];
      const res = await fetch(`${BASE}/api/routers/${selectedRouterId}/hotspot-servers`, { signal });
      if (!res.ok) return [];
      const data = await res.json() as { servers?: { name: string; disabled?: boolean }[] };
      return (data.servers ?? []).filter((s) => !!s.name && !s.disabled);
    },
    enabled: showAddUser && !!selectedRouterId,
    staleTime: 60_000,
  });

  const [addServerPopoverOpen, setAddServerPopoverOpen] = useState(false);
  const [addProfilePopoverOpen, setAddProfilePopoverOpen] = useState(false);
  const [addUnitPopoverOpen, setAddUnitPopoverOpen]     = useState(false);

  function openAddUserDialog() {
    setAddName(""); setAddPassword(""); setAddShowPassword(false); setAddServer("all"); setAddProfile("");
    setAddComment(""); setAddLimitUptime(""); setAddLimitBytes("");
    setAddLimitBytesUnit("MB"); setAddMac("");
    setAddError("");
    setAddDialogMode("create"); setAddEditOriginalName(""); setAddEditLoading(false); setAddRecapUser(null);
    setAddServerPopoverOpen(false); setAddProfilePopoverOpen(false); setAddUnitPopoverOpen(false);
    setShowAddUser(true);
  }

  useEffect(() => {
    const handler = () => openAddUserDialog();
    window.addEventListener("open-add-client-dialog", handler);
    return () => window.removeEventListener("open-add-client-dialog", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAddHotspotUser() {
    setAddError("");
    if (!addName.trim())    { setAddError("Le nom d'utilisateur est requis."); return; }
    if (!addPassword.trim()){ setAddError("Le mot de passe est requis."); return; }
    if (!addProfile)        { setAddError("Le profil est requis."); return; }
    if (!selectedRouterId)  { setAddError("Aucun routeur sélectionné."); return; }

    let limitBytesTotal: string | undefined;
    if (addLimitBytes.trim()) {
      const bytes = parseFloat(addLimitBytes) * (addLimitBytesUnit === "GB" ? 1073741824 : 1048576);
      limitBytesTotal = String(Math.round(bytes));
    }

    setAddLoading(true);
    try {
      const res = await fetch(`${BASE}/api/routers/${selectedRouterId}/hotspot-users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: addName.trim(),
          password: addPassword.trim(),
          profile: addProfile,
          server: addServer === "all" ? undefined : addServer,
          comment: addComment.trim() || undefined,
          limitUptime: addLimitUptime.trim() || undefined,
          limitBytesTotal,
        }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setAddError(data.error ?? "Erreur MikroTik");
      } else {
        const recapName = addName.trim();
        setAddRecapUser({
          name: recapName,
          password: addPassword.trim(),
          profile: addProfile,
          server: addServer || "all",
          limitUptime: addLimitUptime.trim(),
          limitBytes: limitBytesTotal ?? "",
          comment: addComment.trim(),
        });
        setAddEditOriginalName(recapName);
        setAddDialogMode("recap");
        setAddError("");
      }
    } catch {
      setAddError("Erreur réseau. Réessayez.");
    } finally {
      setAddLoading(false);
    }
  }

  async function handleEditCreatedUser() {
    if (!selectedRouterId || !addEditOriginalName) return;
    setAddEditLoading(true);
    setAddError("");
    try {
      const res = await fetch(
        `${BASE}/api/routers/${selectedRouterId}/users/${encodeURIComponent(addEditOriginalName)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            newUsername: addName.trim(),
            password: addPassword.trim(),
            profile: addProfile,
            linkBypass: false,
          }),
        },
      );
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setAddError(data.error ?? "Erreur MikroTik");
      } else {
        setAddEditOriginalName(addName.trim());
        setAddError("");
      }
    } catch {
      setAddError("Erreur réseau. Réessayez.");
    } finally {
      setAddEditLoading(false);
    }
  }

  function openPwdDialog() {
    setPwdNew("");
    setPwdError(""); setPwdSuccess(false);
    setShowPwd(true);
  }

  async function handleChangePwd() {
    setPwdError("");
    if (!pwdNew) {
      setPwdError("Le mot de passe est requis."); return;
    }
    if (pwdNew.length < 4) {
      setPwdError("Le mot de passe doit comporter au moins 4 caractères."); return;
    }
    setPwdLoading(true);
    const pwdEndpoint = isCollaborateur
      ? `${BASE}/api/collaborateurs/me/password`
      : `${BASE}/api/managers/me/password`;
    try {
      const res = await fetch(pwdEndpoint, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ newPassword: pwdNew }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setPwdError(data.error ?? "Erreur inconnue");
      } else {
        setPwdSuccess(true);
      }
    } catch {
      setPwdError("Erreur réseau. Réessayez.");
    } finally {
      setPwdLoading(false);
    }
  }

  const { data: voucherCount } = useQuery<number>({
    queryKey: ["router-users-count", selectedRouterId],
    queryFn: async (): Promise<number> => {
      const res = await fetch(`${BASE}/api/routers/${selectedRouterId}/users`);
      if (!res.ok) return 0;
      const data: unknown = await res.json();
      if (Array.isArray(data)) return data.length;
      if (data && typeof data === "object") {
        const d = data as Record<string, unknown>;
        if (typeof d.total === "number") return d.total;
        if (Array.isArray(d.users)) return d.users.length;
      }
      return 0;
    },
    enabled: !!selectedRouterId && isVouchersPage,
    refetchInterval: 120_000,
    staleTime: 115_000,
    throwOnError: false,
  });

  const navGroups = [
    {
      label: "Réseau",
      collapsible: false,
      items: [
        { href: "/",              label: "Tableau de bord", icon: LayoutDashboard },
        ...(!isManager && !isCollaborateur ? [{ href: "/routers", label: "Routeurs", icon: Router }] : []),
        { href: "/forfaits", label: "Forfaits", icon: PackageOpen },
      ],
      sub: {
        label: "Hotspot",
        icon: Wifi,
        items: [
          { href: "/sessions",        label: "Clients actifs",  icon: Activity },
          { href: "/ip-bindings",     label: "Bypass MAC",      icon: ShieldCheck },
          { href: "/dhcp-leases",     label: "DHCP Leases",     icon: Database },
          { href: "/hotspot-cookies", label: "Cookies Hotspot", icon: Cookie },
        ],
      },
    },
    {
      label: "Tickets",
      collapsible: false,
      items: [
        { href: "/generate",      label: "Générer un ticket",   icon: Zap },
        { href: "/vouchers",      label: "Mes Tickets",         icon: Ticket },
        { href: "/ticket-lookup", label: "Vérifier un ticket",  icon: SearchCheck },
        { href: "/sales/report",  label: "Rapport de vente",    icon: Receipt },
      ],
      sub: {
        key: "vendors",
        label: "Suivi de vente par vendeur",
        icon: Users,
        items: [
          { href: "/vendors",                    label: "Vendeurs",             icon: Users },
          ...(hasVendors ? [{ href: "/vendors/versement-du-jour", label: "Versement Journalier", icon: CreditCard }] : []),
          ...(hasVendors ? [{ href: "/vendors/versements",        label: "Versement Hebdo",      icon: Wallet }] : []),
          ...(hasVendors ? [{ href: "/vendors/tracking",          label: "Rapport par vendeur",  icon: ListOrdered }] : []),
        ],
      },
    },
    {
      label: "Outils",
      collapsible: false,
      items: [
        { href: "/ticket-template", label: "Modèle de ticket", icon: FileCode },
        ...((isAdmin || isSuperAdmin) ? [{ href: "/managers",      label: "Gérants de zone", icon: UserCog }] : []),
        ...((isAdmin || isSuperAdmin) ? [{ href: "/collaborateurs", label: "Collaborateurs",  icon: Users }] : []),
        ...(isAdmin ? [{ href: "/maintenance", label: "Maintenance", icon: Wrench }] : []),
      ],
    },
    ...(isSuperAdmin ? [{
      label: "Super Admin",
      collapsible: false,
      items: [
        { href: "/super/admins", label: "Administrateurs", icon: Crown },
      ],
    }] : []),
  ];

  return (
    <div className="flex flex-col h-auto min-h-0 md:h-full">

      {/* ── Brand ── */}
      <div className="px-5 pt-5 pb-4 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-xl bg-blue-500/15 ring-1 ring-blue-500/30">
            <Wifi className="h-4 w-4 text-blue-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-white leading-none">nanoTECH Vouchers Bills</p>
            <p className="text-[10px] text-gray-500 mt-0.5 leading-none truncate">
              {routerIdentity ?? "Gestion Hotspot MikroTik"}
            </p>
          </div>
        </div>
      </div>

      {/* ── Divider ── */}
      <div className="mx-4 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent flex-shrink-0" />

      {/* ── Router selector ── */}
      <div className="px-3 pt-3 pb-2 flex-shrink-0">
        <p className="px-1 mb-1.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-gray-600">
          Routeur actif
        </p>
        <RouterSelector />
      </div>

      {/* ── Nav ── */}
      <nav
        className={cn(
          "flex-none sidebar-nav px-3 py-2 min-h-0",
          mobileDrawer
            ? "overflow-x-hidden overflow-y-visible"
            : "overflow-x-hidden overflow-y-auto md:flex-1",
        )}
      >

        {/* ── Notification stock faible — always visible ── */}
        {(() => {
          const hasAlerts = lowStockCount > 0;
          return (
            <div className="mb-3">
              <p className="px-2 mb-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-gray-600">
                Alertes
              </p>
              <Link
                href="/stock-alerts"
                onClick={(e) => handleTabClick("/stock-alerts", e)}
                className={cn(
                  "flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-all duration-150",
                  hasAlerts
                    ? "text-red-400 bg-red-500/10 hover:bg-red-500/20"
                    : "text-gray-500 hover:bg-white/[0.06] hover:text-gray-300",
                )}
              >
                <span className="relative flex-shrink-0">
                  <Bell className={cn(
                    "h-4 w-4 transition-colors",
                    hasAlerts ? "text-red-400" : "text-gray-600",
                  )} />
                  {hasAlerts && (
                    <span className="absolute -top-1 -right-1 flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                    </span>
                  )}
                </span>
                <span className="flex-1 truncate">
                  {hasAlerts ? "Stocks faibles" : "Stocks OK"}
                </span>
                <span className={cn(
                  "text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center tabular-nums leading-none",
                  hasAlerts
                    ? "bg-red-500 text-white"
                    : "bg-white/8 text-gray-600",
                )}>
                  {lowStockCount}
                </span>
              </Link>

            </div>
          );
        })()}

        {navGroups.map((group, gi) => (
            /* ── Groupe normal ── */
            <div key={group.label} className={cn("mb-1", gi > 0 && "mt-3")}>
              <p className="px-2 mb-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-gray-600">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map(({ href, label, icon: Icon }) => {
                  const isActive = isNavActive(href);
                  const showVoucherBadge = href === "/vouchers" && selectedRouterId && voucherCount !== undefined && voucherCount > 0;
                  return (
                    <div key={href}>
                      <Link
                        href={href}
                        onClick={(e) => handleTabClick(href, e)}
                        className={cn(
                          "flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-all duration-150",
                          isActive
                            ? "bg-blue-500/15 text-blue-300 shadow-[inset_2px_0_0_#60a5fa]"
                            : "text-gray-400 hover:bg-white/[0.06] hover:text-gray-100",
                        )}
                      >
                        <Icon className={cn("h-4 w-4 flex-shrink-0 transition-colors", isActive ? "text-blue-400" : "text-gray-500")} />
                        <span className="flex-1 truncate">{label}</span>
                        {showVoucherBadge && (
                          <span className={cn(
                            "text-[10px] font-semibold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center tabular-nums",
                            isActive ? "bg-blue-500/20 text-blue-300" : "bg-white/8 text-gray-400",
                          )}>
                            {voucherCount!.toLocaleString("fr-FR")}
                          </span>
                        )}
                      </Link>
                      {/* Ajouter un utilisateur hotspot — juste après Générer */}
                      {href === "/generate" && (isAdmin || isManager || isCollaborateur) && (
                        <button
                          onClick={openAddUserDialog}
                          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-all duration-150 text-gray-400 hover:text-gray-100"
                          title="Ajouter un utilisateur hotspot"
                        >
                          <UserPlus className="h-4 w-4 flex-shrink-0 text-gray-500" />
                          <span className="flex-1 truncate text-left">Ajouter un client</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {"sub" in group && group.sub && (() => {
                const sub = group.sub as { key?: string; label: string; icon: React.ElementType; items: { href: string; label: string; icon: React.ElementType }[] };
                const isVendorSub = sub.key === "vendors";
                const subIsOpen  = isVendorSub ? vendorsOpen  : hotspotOpen;
                const toggleSub  = isVendorSub
                  ? () => setVendorsOpen((v) => !v)
                  : () => setHotspotOpen((v) => !v);
                const SubIcon = sub.icon;
                const isSubActive = sub.items.some(({ href }) => isNavActive(href));
                return (
                  <div className="mt-0.5">
                    <button
                      onClick={toggleSub}
                      className={cn(
                        "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium transition-all duration-150",
                        isSubActive && !subIsOpen
                          ? "text-blue-300"
                          : "text-gray-400 hover:bg-white/[0.06] hover:text-gray-100",
                      )}
                    >
                      <SubIcon className={cn("h-4 w-4 flex-shrink-0", isSubActive && !subIsOpen ? "text-blue-400" : "text-gray-500")} />
                      <span className="flex-1 text-left">{sub.label}</span>
                      {!subIsOpen && (
                        <span className="text-[10px] font-semibold tabular-nums bg-white/8 text-gray-500 rounded-full px-1.5 py-0.5">
                          {sub.items.length}
                        </span>
                      )}
                      <ChevronDown className={cn("h-3.5 w-3.5 text-gray-500 flex-shrink-0 transition-transform duration-200", subIsOpen && "rotate-180")} />
                    </button>
                    {subIsOpen && (
                      <div className="space-y-0.5 mt-0.5">
                        {sub.items.map(({ href, label, icon: Icon }) => {
                          const isActive = isNavActive(href);
                          return (
                            <Link
                              key={href}
                              href={href}
                              onClick={(e) => handleTabClick(href, e)}
                              className={cn(
                                "flex items-center gap-2.5 pl-8 pr-2.5 py-2 rounded-lg text-sm font-medium transition-all duration-150",
                                isActive
                                  ? "bg-blue-500/15 text-blue-300 shadow-[inset_2px_0_0_#60a5fa]"
                                  : "text-gray-400 hover:bg-white/[0.06] hover:text-gray-100",
                              )}
                            >
                              <Icon className={cn("h-4 w-4 flex-shrink-0", isActive ? "text-blue-400" : "text-gray-500")} />
                              <span className="flex-1 truncate">{label}</span>
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
        ))}
      </nav>

      {/* ── Divider ── */}
      <div className="mx-4 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent flex-shrink-0" />

      {/* ── Footer ── */}
      <div className="px-3 py-3 flex-shrink-0 space-y-1.5">
        {/* Role badge + password button row */}
        <div className="flex items-center justify-between gap-2">
          {isManager ? (
            <span className="text-[9px] font-semibold uppercase tracking-wide text-amber-400/80 bg-amber-400/10 px-2 py-0.5 rounded-full ring-1 ring-amber-400/20">
              Gérant de zone
            </span>
          ) : isCollaborateur ? (
            <span className="text-[9px] font-semibold uppercase tracking-wide text-purple-400/80 bg-purple-400/10 px-2 py-0.5 rounded-full ring-1 ring-purple-400/20">
              Collaborateur
            </span>
          ) : isAdmin ? (
            <span className="text-[9px] font-semibold uppercase tracking-wide text-blue-400/70 bg-blue-400/10 px-2 py-0.5 rounded-full ring-1 ring-blue-400/20">
              Admin
            </span>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-1">
            {/* Modify password — managers and collaborateurs */}
            {(isManager || isCollaborateur) && (
              <button
                onClick={openPwdDialog}
                className="flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-amber-300 transition-colors px-2 py-1 rounded-lg hover:bg-amber-500/10 whitespace-nowrap"
                title="Modifier mon mot de passe"
              >
                <KeyRound className="h-3.5 w-3.5" />
                <span>Mot de passe</span>
              </button>
            )}
          </div>
        </div>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-1.5 text-[11px] font-medium text-gray-500 hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10 whitespace-nowrap"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span>Déconnexion</span>
        </button>
      </div>

      {/* ── Password change dialog (manager only) ── */}
      <Dialog open={showPwd} onOpenChange={(v) => { if (!v) setShowPwd(false); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-amber-500" />
              Modifier mon mot de passe
            </DialogTitle>
          </DialogHeader>

          {pwdSuccess ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="h-12 w-12 rounded-full bg-emerald-100 flex items-center justify-center">
                <CheckCircle2 className="h-6 w-6 text-emerald-600" />
              </div>
              <p className="text-sm font-medium text-emerald-700">Mot de passe modifié avec succès !</p>
              <Button className="mt-2" onClick={() => setShowPwd(false)}>Fermer</Button>
            </div>
          ) : (
            <>
              <div className="space-y-3 py-2">
                <div className="space-y-1">
                  <Label className="text-xs">Mot de passe</Label>
                  <PasswordInput
                    value={pwdNew}
                    onChange={(e) => setPwdNew(e.target.value)}
                    placeholder="••••••••"
                    className="h-9 text-sm"
                    autoComplete="new-password"
                    onKeyDown={(e) => e.key === "Enter" && void handleChangePwd()}
                    autoFocus
                  />
                </div>
                {pwdError && (
                  <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{pwdError}</p>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowPwd(false)} disabled={pwdLoading}>
                  Annuler
                </Button>
                <Button onClick={() => void handleChangePwd()} disabled={pwdLoading}>
                  {pwdLoading ? "Enregistrement…" : "Enregistrer"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Add hotspot user dialog — style Mikhmon compact ── */}
      <Dialog open={showAddUser} onOpenChange={(v) => {
        if (!v && !addLoading && !addEditLoading) {
          setShowAddUser(false);
          setAddDialogMode("create");
          setAddEditOriginalName("");
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
              onClick={() => { setShowAddUser(false); setAddDialogMode("create"); setAddEditOriginalName(""); setAddRecapUser(null); }}
              disabled={addLoading || addEditLoading}
              className="h-7 text-xs bg-amber-500 hover:bg-amber-600 text-white gap-1 px-2.5">
              <X className="h-3 w-3" /> Fermer
            </Button>
            {(addDialogMode === "edit" || addDialogMode === "recap") && (
              <Button type="button" size="sm"
                onClick={openAddUserDialog}
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
                onClick={() => void (addDialogMode === "edit" ? handleEditCreatedUser() : handleAddHotspotUser())}
                disabled={addLoading || addEditLoading || !selectedRouterId}
                className="h-7 text-xs bg-cyan-500 hover:bg-cyan-600 text-white gap-1 px-2.5">
                {(addLoading || addEditLoading) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
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

            {/* ── EDIT mode banner ── */}
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
                    disabled={addLoading || addEditLoading || addDialogMode === "edit"}
                    className="h-8 w-full justify-between text-xs font-normal bg-slate-600 border-slate-500 text-slate-100 hover:bg-slate-500 hover:text-white px-2 disabled:opacity-40">
                    <span className="truncate">{addServer || "all"}</span>
                    <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-70" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-1 max-h-48 overflow-y-auto" align="start">
                  <button type="button" onClick={() => { setAddServer("all"); setAddServerPopoverOpen(false); }}
                    className="flex w-full items-center gap-2 px-2 py-1 text-xs rounded hover:bg-gray-100 text-left">
                    <Check className={`h-3 w-3 ${addServer === "all" ? "opacity-100 text-blue-600" : "opacity-0"}`} />
                    all
                  </button>
                  {(dialogServers ?? []).map((s) => (
                    <button key={s.name} type="button" onClick={() => { setAddServer(s.name); setAddServerPopoverOpen(false); }}
                      className="flex w-full items-center gap-2 px-2 py-1 text-xs rounded hover:bg-gray-100 text-left">
                      <Check className={`h-3 w-3 ${addServer === s.name ? "opacity-100 text-blue-600" : "opacity-0"}`} />
                      {s.name}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            </div>

            {/* Name */}
            <div className="grid grid-cols-[68px_1fr] items-center gap-2">
              <Label className="text-xs text-slate-300 font-normal">Name</Label>
              <Input value={addName} onChange={(e) => setAddName(e.target.value)}
                disabled={addLoading || addEditLoading}
                className="h-8 text-xs bg-slate-600 border-slate-500 text-slate-100 placeholder:text-slate-400 focus-visible:ring-cyan-500"
                autoComplete="off" />
            </div>
            {/* Password */}
            <div className="grid grid-cols-[68px_1fr] items-center gap-2">
              <Label className="text-xs text-slate-300 font-normal">Password</Label>
              <div className="relative">
                <Input type={addShowPassword ? "text" : "password"} value={addPassword}
                  onChange={(e) => setAddPassword(e.target.value)}
                  disabled={addLoading || addEditLoading}
                  className="h-8 text-xs bg-slate-600 border-slate-500 text-slate-100 placeholder:text-slate-400 focus-visible:ring-cyan-500 pr-8"
                  autoComplete="new-password" />
                <button type="button" onClick={() => setAddShowPassword((v) => !v)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 flex items-center justify-center rounded bg-white text-slate-700 hover:bg-slate-100">
                  {addShowPassword ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                </button>
              </div>
            </div>
            {/* Profile */}
            <div className="grid grid-cols-[68px_1fr] items-center gap-2">
              <Label className="text-xs text-slate-300 font-normal">Profile</Label>
              <Popover open={addProfilePopoverOpen} onOpenChange={setAddProfilePopoverOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox"
                    disabled={addLoading || addEditLoading}
                    className="h-8 w-full justify-between text-xs font-normal bg-slate-600 border-slate-500 text-slate-100 hover:bg-slate-500 hover:text-white px-2">
                    <span className="truncate">{addProfile || "—"}</span>
                    <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-70" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-1 max-h-56 overflow-y-auto" align="start">
                  {(dialogProfiles ?? []).length === 0 && (
                    <p className="px-2 py-1 text-xs text-gray-400">Aucun profil disponible.</p>
                  )}
                  {(dialogProfiles ?? []).map((p) => (
                    <button key={p.name} type="button" onClick={() => {
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
              <Input value={addLimitUptime} onChange={(e) => setAddLimitUptime(e.target.value)}
                disabled={addLoading || addEditLoading || addDialogMode === "edit"}
                placeholder="30d, 12h, 4w3d"
                className="h-8 text-xs bg-slate-600 border-slate-500 text-slate-100 placeholder:text-slate-400 focus-visible:ring-cyan-500 disabled:opacity-40" />
            </div>
            {/* Data Limit */}
            <div className="grid grid-cols-[68px_1fr] items-center gap-2">
              <Label className="text-xs text-slate-300 font-normal">Data Limit</Label>
              <div className="flex gap-1.5">
                <Input type="number" min="0" value={addLimitBytes} onChange={(e) => setAddLimitBytes(e.target.value)}
                  disabled={addLoading || addEditLoading || addDialogMode === "edit"}
                  className="h-8 text-xs flex-1 bg-slate-600 border-slate-500 text-slate-100 placeholder:text-slate-400 focus-visible:ring-cyan-500 disabled:opacity-40" />
                <Popover open={addUnitPopoverOpen} onOpenChange={setAddUnitPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox"
                      disabled={addLoading || addEditLoading || addDialogMode === "edit"}
                      className="h-8 w-16 justify-between text-xs font-normal bg-slate-600 border-slate-500 text-slate-100 hover:bg-slate-500 hover:text-white px-2 disabled:opacity-40">
                      {addLimitBytesUnit}
                      <ChevronsUpDown className="h-3 w-3 opacity-70" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-16 p-1" align="end">
                    {(["MB", "GB"] as const).map((u) => (
                      <button key={u} type="button" onClick={() => { setAddLimitBytesUnit(u); setAddUnitPopoverOpen(false); }}
                        className="flex w-full items-center gap-1.5 px-2 py-1 text-xs rounded hover:bg-gray-100 text-left">
                        <Check className={`h-3 w-3 ${addLimitBytesUnit === u ? "opacity-100 text-blue-600" : "opacity-0"}`} />
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
                disabled={addLoading || addEditLoading || addDialogMode === "edit"}
                className="h-8 text-xs bg-slate-600 border-slate-500 text-slate-100 placeholder:text-slate-400 focus-visible:ring-cyan-500 disabled:opacity-40" />
            </div>

            {addError && (
              <p className="text-xs text-red-400 bg-red-900/40 border border-red-700 rounded px-2 py-1.5">{addError}</p>
            )}
            {!selectedRouterId && (
              <p className="text-xs text-amber-300 bg-amber-900/30 border border-amber-700 rounded px-2 py-1.5">
                ⚠ Sélectionnez d'abord un routeur dans la barre latérale.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const isMobile = useIsMobile();

  return (
    <div className="flex h-svh bg-gray-100 dark:bg-gray-950 overflow-hidden">

      {/* ── Desktop sidebar ── */}
      {!isMobile && (
        <aside className="w-60 bg-[#0d1117] text-white flex-col flex-shrink-0 border-r border-white/[0.06] md:flex fixed top-0 left-0 z-10 h-svh overflow-y-auto sidebar-scroll">
          <NavContent />
        </aside>
      )}

      {/* ── Mobile: top bar + custom slide-in drawer ── */}
      <div className={cn("flex flex-col flex-1 min-w-0 overflow-hidden", !isMobile && "ml-60")}>

        {/* Mobile top bar — 2 rows to avoid overlap on portrait phones */}
        {isMobile && (
          <header className="bg-[#0d1117] text-white px-3 pt-2 pb-2.5 flex-shrink-0 border-b border-white/[0.06] z-30 relative">
            {/* Row 1: hamburger + app name */}
            <div className="flex items-center gap-2 mb-2">
              <Button
                size="icon"
                variant="ghost"
                className="text-gray-400 hover:text-white hover:bg-white/10 h-8 w-8 flex-shrink-0 transition-colors"
                onClick={() => setMobileOpen((o) => !o)}
                aria-label={mobileOpen ? "Fermer le menu" : "Ouvrir le menu"}
              >
                {mobileOpen
                  ? <X className="h-5 w-5 transition-transform duration-200" />
                  : <Menu className="h-5 w-5 transition-transform duration-200" />}
              </Button>
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className="flex items-center justify-center w-6 h-6 rounded-lg bg-blue-500/15 ring-1 ring-blue-500/30 flex-shrink-0">
                  <Wifi className="h-3.5 w-3.5 text-blue-400" />
                </div>
                <span className="font-bold text-white truncate text-sm leading-none">nanoTECH Vouchers Bills</span>
              </div>
            </div>
            {/* Row 2: router selector — masqué quand le menu est ouvert (il est déjà visible dedans) */}
            {!mobileOpen && <RouterSelector compact className="w-full" />}
          </header>
        )}

        {/* Mobile slide-in drawer — positioned below the header */}
        {isMobile && (
          <div className="relative flex-1 min-w-0 overflow-hidden flex flex-col">
            {/* Backdrop */}
            {mobileOpen && (
              <div
                className="absolute inset-0 bg-black/50 z-10"
                onClick={() => setMobileOpen(false)}
              />
            )}

            {/* Sliding nav panel — full height so it never clips content */}
            <div
              className={cn(
                "absolute top-0 left-0 h-full w-64 max-w-[min(18rem,85vw)] bg-[#0d1117] text-white border-r border-white/[0.06] z-20 flex flex-col overflow-y-auto overflow-x-hidden transition-transform duration-300 ease-in-out shadow-2xl",
                mobileOpen ? "translate-x-0" : "-translate-x-full"
              )}
            >
              <NavContent mobileDrawer onNavigate={() => setMobileOpen(false)} />
            </div>

            {/* Main content — scrollable always, pointer-events blocked by backdrop when menu open */}
            <main className="flex-1 overflow-y-auto">
              <div className="p-3 sm:p-6 max-w-7xl mx-auto">{children}</div>
            </main>
          </div>
        )}

        {/* Desktop main content (no drawer) */}
        {!isMobile && (
          <main className="flex-1 overflow-y-auto">
            <div className="p-3 sm:p-6 max-w-7xl mx-auto">{children}</div>
          </main>
        )}
      </div>
    </div>
  );
}
