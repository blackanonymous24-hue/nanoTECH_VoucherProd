import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Router, Ticket, Zap, Wifi,
  PackageOpen, Activity, Users, BarChart3, FileCode, LogOut, UserCog,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useRouterContext } from "@/contexts/RouterContext";
import { useAuth } from "@/contexts/AuthContext";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const {
    selectedRouterId, setSelectedRouterId,
    routers, routersLoading, routerOnline, routerIdentity,
  } = useRouterContext();
  const { logout, role } = useAuth();
  const isAdmin = role === "admin";

  const navGroups = [
    {
      label: "Réseau",
      items: [
        { href: "/",         label: "Tableau de bord", icon: LayoutDashboard },
        { href: "/routers",  label: "Routeurs",         icon: Router },
        { href: "/forfaits", label: "Forfaits",          icon: PackageOpen },
        { href: "/sessions", label: "Clients actifs",   icon: Activity },
      ],
    },
    {
      label: "Vouchers",
      items: [
        { href: "/generate", label: "Générer",  icon: Zap },
        { href: "/vouchers", label: "Vouchers", icon: Ticket },
        { href: "/vendors",  label: "Vendeurs", icon: Users },
        { href: "/reports",  label: "Rapports", icon: BarChart3 },
      ],
    },
    {
      label: "Outils",
      items: [
        { href: "/ticket-template", label: "Modèle de ticket", icon: FileCode },
        ...(isAdmin ? [{ href: "/managers", label: "Gérants de zone", icon: UserCog }] : []),
      ],
    },
  ];

  return (
    <div className="flex h-screen bg-gray-100">
      <aside className="w-60 bg-gray-900 text-white flex flex-col flex-shrink-0 min-h-0">

        {/* ── Brand ── */}
        <div className="px-5 py-4 border-b border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Wifi className="h-6 w-6 text-blue-400" />
            <span className="text-lg font-bold text-white">VoucherNet</span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            {routerIdentity ?? "Gestion Hotspot MikroTik"}
          </p>
        </div>

        {/* ── Router selector ── */}
        <div className="px-3 pt-3 pb-2 flex-shrink-0">
          <div className="flex items-center justify-between mb-1.5 px-1">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Routeur actif
            </p>
            {selectedRouterId && routerOnline === true && (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
            )}
            {selectedRouterId && routerOnline === false && (
              <span className="relative flex h-2 w-2">
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
              </span>
            )}
          </div>
          {routersLoading && routers.length === 0 ? (
            <div className="h-8 bg-gray-800 rounded-md animate-pulse" />
          ) : (
            <Select
              value={selectedRouterId ? String(selectedRouterId) : ""}
              onValueChange={(v) => setSelectedRouterId(v ? parseInt(v, 10) : null)}
              disabled={routers.length === 0}
            >
              <SelectTrigger className="h-8 text-xs bg-gray-800 border-gray-700 text-white hover:bg-gray-700 focus:ring-0 focus:ring-offset-0 disabled:opacity-50 disabled:cursor-not-allowed">
                <SelectValue placeholder="Sélectionner..." />
              </SelectTrigger>
              <SelectContent>
                {routers.map((r) => (
                  <SelectItem key={r.id} value={String(r.id)} className="text-xs">
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* ── Nav — scrollable ── */}
        <nav className="flex-1 overflow-y-auto px-3 py-2 min-h-0 sidebar-nav">
          {navGroups.map((group) => (
            <div key={group.label} className="mb-3">
              <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map(({ href, label, icon: Icon }) => {
                  const isActive =
                    href === "/" ? location === "/" : location.startsWith(href);
                  return (
                    <Link
                      key={href}
                      href={href}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                        isActive
                          ? "bg-blue-600 text-white"
                          : "text-gray-300 hover:bg-gray-800 hover:text-white",
                      )}
                    >
                      <Icon className="h-4 w-4 flex-shrink-0" />
                      {label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* ── Footer ── */}
        <div className="px-4 py-3 border-t border-gray-700 flex-shrink-0 flex items-center justify-between gap-2">
          {role === "manager" ? (
            <span className="text-[10px] text-amber-400">Gérant de zone</span>
          ) : (
            <span />
          )}
          <button
            onClick={logout}
            className="flex items-center gap-1.5 text-xs font-medium text-red-400 hover:text-red-300 transition-colors px-2 py-1 rounded hover:bg-red-900/30 whitespace-nowrap"
          >
            <LogOut className="h-3.5 w-3.5" /> Se déconnecter
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="p-6 max-w-7xl mx-auto">{children}</div>
      </main>
    </div>
  );
}
