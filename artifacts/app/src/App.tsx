import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
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

function PageSkeleton() {
  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Title bar */}
      <div className="flex items-center justify-between">
        <div className="skeleton h-7 w-48 rounded-md" />
        <div className="skeleton h-8 w-24 rounded-md" />
      </div>

      {/* Stat cards row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white border border-gray-100 rounded-xl p-4 space-y-3 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="skeleton h-10 w-10 rounded-lg flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="skeleton h-5 w-16 rounded" />
                <div className="skeleton h-3 w-20 rounded" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Table skeleton */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <div className="border-b border-gray-100 px-4 py-3 flex items-center gap-3">
          <div className="skeleton h-5 w-32 rounded" />
          <div className="skeleton h-7 w-40 rounded-md ml-auto" />
        </div>
        <div className="divide-y divide-gray-50">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="px-4 py-3 flex items-center gap-4">
              <div className="skeleton h-8 w-8 rounded-full flex-shrink-0" />
              <div className="skeleton h-4 flex-1 rounded" style={{ maxWidth: `${55 + (i % 3) * 15}%` }} />
              <div className="skeleton h-4 w-16 rounded hidden sm:block" />
              <div className="skeleton h-6 w-14 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AppRoutes() {
  const [location] = useLocation();
  const { isAuthenticated, role } = useAuth();
  const [routeReloadToken, setRouteReloadToken] = useState(0);
  const [isRouteLoading, setIsRouteLoading] = useState(true);
  const qc = useQueryClient();
  const prevLocationRef = useRef(location);

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

  // useLayoutEffect fires before paint → skeleton shows BEFORE new page content appears
  useLayoutEffect(() => {
    setIsRouteLoading(true);
    const timer = window.setTimeout(() => setIsRouteLoading(false), 400);
    return () => window.clearTimeout(timer);
  }, [location, routeReloadToken]);

  // Cancel all in-flight API requests when navigating to a different page
  useEffect(() => {
    if (prevLocationRef.current !== location) {
      void qc.cancelQueries();
      prevLocationRef.current = location;
    }
  }, [location, qc]);

  // Vendor portal manages its own auth — always render it regardless of admin session
  if (location.startsWith("/vendor-portal")) {
    return <VendorPortal />;
  }

  if (!isAuthenticated) {
    const isVendorPage = location === "/vendeur" || location.startsWith("/vendeur/");
    const isChoosePage = location === "/" || location === "/login";
    const loginMode = isVendorPage ? "vendor" : isChoosePage ? "choose" : "admin";
    return <LoginPage mode={loginMode} />;
  }

  if (role === "vendor") {
    return <VendorPortal />;
  }

  return (
    <RouterProvider>
      {/* Top progress bar — fixed overlay, doesn't affect layout */}
      {isRouteLoading && <div className="topbar-track" />}

      <Layout>
        {isRouteLoading ? (
          <PageSkeleton />
        ) : (
          <Switch key={`${location}:${routeReloadToken}`}>
            <Route path="/" component={Dashboard} />
            <Route path="/admin" component={Dashboard} />
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
