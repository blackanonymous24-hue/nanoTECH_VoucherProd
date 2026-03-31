import { Link, useLocation } from "wouter";
import { LayoutDashboard, Router, Ticket, Zap, Wifi, PackageOpen } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Tableau de bord", icon: LayoutDashboard },
  { href: "/routers", label: "Routeurs", icon: Router },
  { href: "/forfaits", label: "Forfaits", icon: PackageOpen },
  { href: "/generate", label: "Générer", icon: Zap },
  { href: "/vouchers", label: "Vouchers", icon: Ticket },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

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
        <nav className="flex-1 px-3 py-4 space-y-1">
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
