import { Link, useLocation } from "wouter";
import { LayoutDashboard, Router, Ticket, Zap, Wifi, PackageOpen, Activity, Users, BarChart3, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRouterContext } from "@/contexts/RouterContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const navItems = [
  { href: "/", label: "Tableau de bord", icon: LayoutDashboard },
  { href: "/routers", label: "Routeurs", icon: Router },
  { href: "/forfaits", label: "Forfaits", icon: PackageOpen },
  { href: "/sessions", label: "Clients actifs", icon: Activity },
  { href: "/generate", label: "Générer", icon: Zap },
  { href: "/vouchers", label: "Vouchers", icon: Ticket },
  { href: "/vendors", label: "Vendeurs", icon: Users },
  { href: "/reports", label: "Rapports", icon: BarChart3 },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { selectedRouterId, setSelectedRouterId, routers, routersLoading, pinging, routerOnline } = useRouterContext();

  return (
    <div className="flex h-screen bg-gray-100">
      <aside className="w-60 bg-gray-900 text-white flex flex-col flex-shrink-0">
        <div className="px-5 py-5 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <Wifi className="h-6 w-6 text-blue-400" />
            <span className="text-lg font-bold text-white">VoucherNet</span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">Gestion Hotspot MikroTik</p>
        </div>

        <div className="px-3 pt-4 pb-2">
          <div className="flex items-center justify-between mb-1.5 px-1">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Routeur actif</p>
            {selectedRouterId && (
              pinging ? (
                <Loader2 className="h-3 w-3 text-gray-500 animate-spin" />
              ) : routerOnline === true ? (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                </span>
              ) : routerOnline === false ? (
                <span className="relative flex h-2 w-2">
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                </span>
              ) : null
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

        <nav className="flex-1 px-3 py-2 space-y-1">
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive = href === "/" ? location === "/" : location.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
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
        </nav>
        <div className="px-4 py-3 border-t border-gray-700 text-xs text-gray-500">
          Compatible MikHmon 7.x
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="p-6 max-w-7xl mx-auto">{children}</div>
      </main>
    </div>
  );
}
