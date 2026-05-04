import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Router, Ticket, Zap, Wifi,
  PackageOpen, Activity, Users, BarChart3, FileCode, LogOut,
  UserCog, Menu, X, Receipt, ListOrdered, Wallet, KeyRound, CheckCircle2, Bell, Wrench, CreditCard, UserPlus, SearchCheck, ShieldCheck, Crown, Database, Cookie, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useRouterContext } from "@/contexts/RouterContext";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAppNavigate } from "@/hooks/use-app-navigate";

import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

function NavContent({ onNavigate }: { onNavigate?: () => void }) {
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
  /* ── Hotspot collapsible ── */
  const hotspotPaths = ["/sessions", "/ip-bindings", "/dhcp-leases", "/hotspot-cookies"];
  const isHotspotPage = hotspotPaths.some((p) => location.startsWith(p));
  const [hotspotOpen, setHotspotOpen] = useState(() => hotspotPaths.some((p) => location.startsWith(p)));
  useEffect(() => { if (isHotspotPage) setHotspotOpen(true); }, [isHotspotPage]);

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
  const [showPwd, setShowPwd]         = useState(false);
  const [pwdCurrent, setPwdCurrent]   = useState("");
  const [pwdNew, setPwdNew]           = useState("");
  const [pwdConfirm, setPwdConfirm]   = useState("");
  const [pwdError, setPwdError]       = useState("");
  const [pwdSuccess, setPwdSuccess]   = useState(false);
  const [pwdLoading, setPwdLoading]   = useState(false);

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
  const [addSuccess, setAddSuccess]             = useState(false);
  const [addLoading, setAddLoading]             = useState(false);

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
        price?: string;
        validity?: string;
        schedulerMonitorActive?: boolean;
      }[];
      return data.map((p) => ({
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

  function openAddUserDialog() {
    setAddName(""); setAddPassword(""); setAddShowPassword(false); setAddServer("all"); setAddProfile("");
    setAddComment(""); setAddLimitUptime(""); setAddLimitBytes("");
    setAddLimitBytesUnit("MB"); setAddMac("");
    setAddError(""); setAddSuccess(false);
    setShowAddUser(true);
  }

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
        setAddSuccess(true);
      }
    } catch {
      setAddError("Erreur réseau. Réessayez.");
    } finally {
      setAddLoading(false);
    }
  }

  function openPwdDialog() {
    setPwdCurrent(""); setPwdNew(""); setPwdConfirm("");
    setPwdError(""); setPwdSuccess(false);
    setShowPwd(true);
  }

  async function handleChangePwd() {
    setPwdError("");
    if (!pwdCurrent || !pwdNew || !pwdConfirm) {
      setPwdError("Tous les champs sont requis."); return;
    }
    if (pwdNew.length < 4) {
      setPwdError("Le nouveau mot de passe doit comporter au moins 4 caractères."); return;
    }
    if (pwdNew !== pwdConfirm) {
      setPwdError("Les nouveaux mots de passe ne correspondent pas."); return;
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
        body: JSON.stringify({ currentPassword: pwdCurrent, newPassword: pwdNew }),
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
        { href: "/",         label: "Tableau de bord", icon: LayoutDashboard },
        ...(!isManager && !isCollaborateur ? [{ href: "/routers", label: "Routeurs", icon: Router }] : []),
        { href: "/forfaits", label: "Forfaits",          icon: PackageOpen },
      ],
    },
    {
      label: "Hotspot",
      collapsible: true,
      items: [
        { href: "/sessions",        label: "Clients actifs",   icon: Activity },
        { href: "/ip-bindings",     label: "Bypass MAC",       icon: ShieldCheck },
        { href: "/dhcp-leases",     label: "DHCP Leases",      icon: Database },
        { href: "/hotspot-cookies", label: "Cookies Hotspot",  icon: Cookie },
      ],
    },
    {
      label: "Tickets",
      collapsible: false,
      items: [
        { href: "/generate",     label: "Générer",             icon: Zap },
        { href: "/vouchers",     label: "Mes Tickets",         icon: Ticket },
        { href: "/ticket-lookup", label: "Vérifier un ticket", icon: SearchCheck },
        { href: "/vendors",      label: "Vendeurs",            icon: Users },
        ...(hasVendors ? [{ href: "/vendors/versement-du-jour", label: "Versement Journalier", icon: CreditCard }] : []),
        ...(hasVendors ? [{ href: "/vendors/versements",        label: "Versement Hebdo",      icon: Wallet }] : []),
        ...(hasVendors ? [{ href: "/vendors/tracking",          label: "Rapport par vendeur",  icon: ListOrdered }] : []),
        { href: "/sales/report", label: "Rapport de vente",   icon: Receipt },
      ],
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
    <div className="flex flex-col h-full">

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
      <nav className="flex-1 overflow-y-auto sidebar-nav px-3 py-2 min-h-0">

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
          group.collapsible ? (
            /* ── Groupe collapsible (Hotspot) ── */
            <div key={group.label} className={cn("mb-1", gi > 0 && "mt-3")}>
              <button
                onClick={() => setHotspotOpen((v) => !v)}
                className="w-full px-2 mb-1 flex items-center justify-between group/hotspot"
              >
                <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-gray-600">
                  {group.label}
                </span>
                <span className="flex items-center gap-1">
                  {!hotspotOpen && (
                    <span className="text-[9px] font-semibold tabular-nums bg-white/8 text-gray-500 rounded-full px-1.5 py-0.5">
                      {group.items.length}
                    </span>
                  )}
                  <ChevronDown className={cn("h-3 w-3 text-gray-600 transition-transform duration-200", hotspotOpen && "rotate-180")} />
                </span>
              </button>
              {hotspotOpen && (
                <div className="space-y-0.5">
                  {group.items.map(({ href, label, icon: Icon }) => {
                    const isActive = isNavActive(href);
                    return (
                      <Link
                        key={href}
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
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
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
            </div>
          )
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
                  <Label className="text-xs">Mot de passe actuel</Label>
                  <Input
                    type="password"
                    value={pwdCurrent}
                    onChange={(e) => setPwdCurrent(e.target.value)}
                    placeholder="••••••••"
                    className="h-9 text-sm"
                    autoComplete="current-password"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Nouveau mot de passe</Label>
                  <Input
                    type="password"
                    value={pwdNew}
                    onChange={(e) => setPwdNew(e.target.value)}
                    placeholder="4 caractères minimum"
                    className="h-9 text-sm"
                    autoComplete="new-password"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Confirmer le nouveau mot de passe</Label>
                  <Input
                    type="password"
                    value={pwdConfirm}
                    onChange={(e) => setPwdConfirm(e.target.value)}
                    placeholder="••••••••"
                    className="h-9 text-sm"
                    autoComplete="new-password"
                    onKeyDown={(e) => e.key === "Enter" && void handleChangePwd()}
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

      {/* ── Add hotspot user dialog (admin + manager) ── */}
      <Dialog open={showAddUser} onOpenChange={(v) => { if (!v) setShowAddUser(false); }}>
        <DialogContent className="w-[95vw] sm:max-w-md p-0 overflow-hidden max-h-[92vh]">
          <DialogHeader className="px-4 pt-3 pb-2 border-b border-gray-200 bg-white">
            <DialogTitle className="text-base font-semibold flex items-center gap-2 text-gray-900">
              <UserPlus className="h-4 w-4" />
              Ajouter un client
            </DialogTitle>
          </DialogHeader>

          {addSuccess ? (
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="h-12 w-12 rounded-full bg-emerald-100 flex items-center justify-center">
                <CheckCircle2 className="h-6 w-6 text-emerald-600" />
              </div>
              <p className="text-sm font-medium text-emerald-700">Utilisateur <strong>{addName}</strong> créé avec succès !</p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => {
                  setAddSuccess(false);
                  setAddName(""); setAddPassword(""); setAddProfile("");
                  setAddComment(""); setAddLimitUptime(""); setAddLimitBytes(""); setAddMac("");
                }}>
                  Ajouter un autre
                </Button>
                <Button onClick={() => setShowAddUser(false)}>Fermer</Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 px-4 pt-3 pb-3 bg-white">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setShowAddUser(false)}
                  disabled={addLoading}
                  variant="outline"
                  className="gap-1.5"
                >
                  <X className="h-3.5 w-3.5" /> Annuler
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleAddHotspotUser()}
                  disabled={addLoading || !selectedRouterId}
                  className="gap-1.5"
                >
                  {addLoading ? "En cours..." : "Enregistrer"}
                </Button>
              </div>

              <div className="px-4 pb-4 space-y-3 bg-white overflow-y-auto">
                <div className="grid grid-cols-1 sm:grid-cols-[100px_1fr] items-start sm:items-center gap-2 sm:gap-3">
                  <Label className="text-sm text-gray-700 font-normal">Serveur</Label>
                  <Select value={addServer} onValueChange={setAddServer}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tous (all)</SelectItem>
                      {(dialogServers ?? []).map((s) => (
                        <SelectItem key={s.name} value={s.name}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-[100px_1fr] items-start sm:items-center gap-2 sm:gap-3">
                  <Label className="text-sm text-gray-700 font-normal">Nom</Label>
                  <Input
                    value={addName}
                    onChange={(e) => setAddName(e.target.value)}
                    placeholder="client123"
                    className="h-9"
                    autoComplete="off"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-[100px_1fr] items-start sm:items-center gap-2 sm:gap-3">
                  <Label className="text-sm text-gray-700 font-normal">Mot de passe</Label>
                  <div className="relative">
                    <Input
                      type={addShowPassword ? "text" : "password"}
                      value={addPassword}
                      onChange={(e) => setAddPassword(e.target.value)}
                      placeholder="mot de passe"
                      className="h-9 pr-10"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setAddShowPassword((v) => !v)}
                      className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-8 flex items-center justify-center rounded bg-white text-slate-700 hover:bg-slate-100"
                    >
                      {addShowPassword ? "Masquer" : "Afficher"}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-[100px_1fr] items-start sm:items-center gap-2 sm:gap-3">
                  <Label className="text-sm text-gray-700 font-normal">Profil</Label>
                  <Select value={addProfile} onValueChange={setAddProfile}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder={dialogProfiles ? "—" : "Chargement…"} />
                    </SelectTrigger>
                    <SelectContent className="max-h-56 overflow-y-auto">
                      {(dialogProfiles ?? []).map((p) => (
                        <SelectItem key={p.name} value={p.name}>
                          <span className="flex items-center gap-2">
                            <span
                              className={`h-2 w-2 rounded-full flex-shrink-0 ${
                                p.schedulerMonitorActive ? "bg-emerald-500" : "bg-orange-400"
                              }`}
                              aria-hidden
                            />
                            {p.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-[100px_1fr] items-start sm:items-center gap-2 sm:gap-3">
                  <Label className="text-sm text-gray-700 font-normal">Limite de temps</Label>
                  <Input
                    value={addLimitUptime}
                    onChange={(e) => setAddLimitUptime(e.target.value)}
                    placeholder="ex: 30d, 12h"
                    className="h-9"
                    autoComplete="off"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-[100px_1fr] items-start sm:items-center gap-2 sm:gap-3">
                  <Label className="text-sm text-gray-700 font-normal">Limite de données</Label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      min={0}
                      value={addLimitBytes}
                      onChange={(e) => setAddLimitBytes(e.target.value)}
                      placeholder="500"
                      className="h-9 text-sm flex-1"
                    />
                    <Select value={addLimitBytesUnit} onValueChange={(v) => setAddLimitBytesUnit(v as "MB" | "GB")}>
                      <SelectTrigger className="h-9 w-20 text-sm flex-shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MB">MB</SelectItem>
                        <SelectItem value="GB">GB</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-[100px_1fr] items-start sm:items-center gap-2 sm:gap-3">
                  <Label className="text-sm text-gray-700 font-normal">Commentaire</Label>
                  <Input
                    value={addComment}
                    onChange={(e) => setAddComment(e.target.value)}
                    placeholder="Commentaire..."
                    className="h-9 text-sm"
                    autoComplete="off"
                  />
                </div>

                {addError && (
                  <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{addError}</p>
                )}

                {!selectedRouterId && (
                  <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    ⚠ Sélectionnez d'abord un routeur dans la barre latérale.
                  </p>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const isMobile = useIsMobile();

  return (
    <div className="flex min-h-svh bg-gray-100 dark:bg-gray-950 overflow-x-hidden">

      {/* ── Desktop sidebar ── */}
      {!isMobile && (
        <aside className="w-60 bg-[#0d1117] text-white flex-col flex-shrink-0 border-r border-white/[0.06] md:flex fixed top-0 left-0 z-10 h-svh overflow-y-auto sidebar-scroll">
          <NavContent />
        </aside>
      )}

      {/* ── Mobile: top bar + custom slide-in drawer ── */}
      <div className={cn("flex flex-col flex-1 min-w-0", !isMobile && "ml-60")}>

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
            {/* Row 2: router selector — full width, no crowding */}
            <RouterSelector compact className="w-full" />
          </header>
        )}

        {/* Mobile slide-in drawer — positioned below the header */}
        {isMobile && (
          <div className="relative flex-1 min-w-0 min-h-0 flex flex-col">
            {/* Backdrop */}
            {mobileOpen && (
              <div
                className="absolute inset-0 bg-black/50 z-10"
                onClick={() => setMobileOpen(false)}
              />
            )}

            {/* Sliding nav panel */}
            <div
              className={cn(
                "absolute top-0 left-0 h-full w-64 bg-[#0d1117] text-white border-r border-white/[0.06] z-20 flex flex-col transition-transform duration-300 ease-in-out",
                mobileOpen ? "translate-x-0" : "-translate-x-full"
              )}
            >
              <NavContent onNavigate={() => setMobileOpen(false)} />
            </div>

            {/* Main content */}
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
