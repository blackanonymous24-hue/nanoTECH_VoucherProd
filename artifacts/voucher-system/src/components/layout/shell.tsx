import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  ShoppingCart, 
  Ticket, 
  Wifi, 
  History,
  Menu,
  Users,
  BarChart3,
  Settings
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

const mainNavItems = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Tableau de bord" },
  { href: "/vente", icon: ShoppingCart, label: "Point de Vente" },
  { href: "/vouchers", icon: Ticket, label: "Gestion Vouchers" },
  { href: "/profils", icon: Wifi, label: "Forfaits & Profils" },
  { href: "/ventes", icon: History, label: "Historique" },
];

const distributorNavItems = [
  { href: "/distributeurs/journalier", icon: BarChart3, label: "Rapport Journalier" },
  { href: "/distributeurs", icon: Users, label: "Distributeurs" },
];

const settingsNavItems = [
  { href: "/parametres/routeros", icon: Settings, label: "RouterOS MikroTik" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);

  const NavLinks = () => (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h3 className="px-3 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider mb-1">Principal</h3>
        {mainNavItems.map((item) => {
          const isActive = location === item.href || (location === "/" && item.href === "/dashboard");
          return (
            <Link key={item.href} href={item.href} onClick={() => setOpen(false)}>
              <div
                className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors cursor-pointer ${
                  isActive 
                    ? "bg-primary text-primary-foreground font-medium" 
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                }`}
              >
                <item.icon className="h-5 w-5" />
                <span>{item.label}</span>
              </div>
            </Link>
          );
        })}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="px-3 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider mb-1">Distributeurs</h3>
        {distributorNavItems.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.href} href={item.href} onClick={() => setOpen(false)}>
              <div
                className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors cursor-pointer ${
                  isActive 
                    ? "bg-primary text-primary-foreground font-medium" 
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                }`}
              >
                <item.icon className="h-5 w-5" />
                <span>{item.label}</span>
              </div>
            </Link>
          );
        })}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="px-3 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider mb-1">Configuration</h3>
        {settingsNavItems.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.href} href={item.href} onClick={() => setOpen(false)}>
              <div
                className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors cursor-pointer ${
                  isActive 
                    ? "bg-primary text-primary-foreground font-medium" 
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                }`}
              >
                <item.icon className="h-5 w-5" />
                <span>{item.label}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      {/* Mobile Header */}
      <header className="md:hidden flex items-center justify-between p-4 border-b bg-card">
        <div className="flex items-center gap-2 text-primary">
          <Wifi className="h-6 w-6" />
          <span className="font-bold text-lg">VoucherNet</span>
        </div>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon">
              <Menu className="h-6 w-6" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 bg-sidebar border-r-0">
            <div className="flex items-center gap-2 text-sidebar-primary mb-8 px-2">
              <Wifi className="h-6 w-6" />
              <span className="font-bold text-xl text-sidebar-foreground">VoucherNet</span>
            </div>
            <NavLinks />
          </SheetContent>
        </Sheet>
      </header>

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 bg-sidebar border-r border-sidebar-border min-h-screen">
        <div className="p-6 flex items-center gap-2 text-sidebar-primary">
          <Wifi className="h-7 w-7" />
          <span className="font-bold text-2xl text-sidebar-foreground tracking-tight">VoucherNet</span>
        </div>
        <nav className="flex-1 px-4 py-2">
          <NavLinks />
        </nav>
        <div className="p-4 border-t border-sidebar-border">
          <div className="text-xs text-sidebar-foreground/50 text-center">
            VoucherNet v1.0.0
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <div className="container mx-auto p-4 md:p-8 max-w-7xl animate-in fade-in slide-in-from-bottom-4 duration-300">
          {children}
        </div>
      </main>
    </div>
  );
}
