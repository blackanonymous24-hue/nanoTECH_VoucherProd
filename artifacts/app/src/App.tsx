import { useEffect, useState } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RouterProvider } from "@/contexts/RouterContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { queryClient } from "@/lib/queryClient";
import Layout from "@/components/Layout";
import LoginPage from "@/pages/LoginPage";
import Dashboard from "@/pages/Dashboard";
import Routers from "@/pages/Routers";
import Forfaits from "@/pages/Forfaits";
import Sessions from "@/pages/Sessions";
import GenerateVouchers from "@/pages/GenerateVouchers";
import Vouchers from "@/pages/Vouchers";
import Vendors from "@/pages/Vendors";
import Reports from "@/pages/Reports";
import SalesRanking from "@/pages/SalesRanking";
import SellingReport from "@/pages/SellingReport";
import VendorPortal from "@/pages/VendorPortal";
import TicketTemplate from "@/pages/TicketTemplate";
import Managers from "@/pages/Managers";
import VendorTracking from "@/pages/VendorTracking";
import VendorPayments from "@/pages/VendorPayments";
import StockAlerts from "@/pages/StockAlerts";
import NotFound from "@/pages/not-found";

function AppRoutes() {
  const [location] = useLocation();
  const { isAuthenticated, role } = useAuth();
  const [routeReloadToken, setRouteReloadToken] = useState(0);
  const [isRouteLoading, setIsRouteLoading] = useState(true);

  useEffect(() => {
    const onForceRemount = (event: Event) => {
      const customEvent = event as CustomEvent<{ path?: string }>;
      const targetPath = customEvent.detail?.path;
      if (!targetPath || targetPath === location) {
        setRouteReloadToken((n) => n + 1);
      }
    };

    window.addEventListener("app:route-remount", onForceRemount as EventListener);
    return () => {
      window.removeEventListener("app:route-remount", onForceRemount as EventListener);
    };
  }, [location]);

  useEffect(() => {
    setIsRouteLoading(true);
    const timer = window.setTimeout(() => setIsRouteLoading(false), 150);
    return () => window.clearTimeout(timer);
  }, [location, routeReloadToken]);

  if (!isAuthenticated) {
    const isVendorPage = location === "/vendeur" || location.startsWith("/vendeur/");
    return <LoginPage mode={isVendorPage ? "vendor" : "admin"} />;
  }

  if (role === "vendor" || location.startsWith("/vendor-portal")) {
    return <VendorPortal />;
  }

  return (
    <RouterProvider>
      <Layout>
        {isRouteLoading ? (
          <div className="flex min-h-[220px] items-center justify-center">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
              Chargement de la page...
            </div>
          </div>
        ) : (
          <Switch key={`${location}:${routeReloadToken}`}>
            <Route path="/" component={Dashboard} />
            <Route path="/vendeur" component={Dashboard} />
            <Route path="/routers" component={Routers} />
            <Route path="/forfaits" component={Forfaits} />
            <Route path="/sessions" component={Sessions} />
            <Route path="/generate" component={GenerateVouchers} />
            <Route path="/vouchers" component={Vouchers} />
            <Route path="/vendors" component={Vendors} />
            <Route path="/reports" component={Reports} />
            <Route path="/sales/daily" component={() => <SalesRanking period="daily" />} />
            <Route path="/sales/monthly" component={() => <SalesRanking period="monthly" />} />
            <Route path="/sales/report" component={SellingReport} />
            <Route path="/vendors/tracking" component={VendorTracking} />
            <Route path="/vendors/versements" component={VendorPayments} />
            <Route path="/ticket-template" component={TicketTemplate} />
            <Route path="/managers" component={Managers} />
            <Route path="/stock-alerts" component={StockAlerts} />
            <Route component={NotFound} />
          </Switch>
        )}
      </Layout>
    </RouterProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
