import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { getListRouterLogsQueryKey, listRouterLogs } from "@workspace/api-client-react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RouterProvider } from "@/contexts/RouterContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { queryClient } from "@/lib/queryClient";
import Layout from "@/components/Layout";
import { PageErrorBoundary } from "@/components/PageErrorBoundary";
import { SessionLifecycle } from "@/components/SessionLifecycle";

const LoginPage = lazy(() => import("@/pages/LoginPage"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Routers = lazy(() => import("@/pages/Routers"));
const Forfaits = lazy(() => import("@/pages/Forfaits"));
const Sessions = lazy(() => import("@/pages/Sessions"));
const IpBindings = lazy(() => import("@/pages/IpBindings"));
const DhcpLeases = lazy(() => import("@/pages/DhcpLeases"));
const HotspotCookies = lazy(() => import("@/pages/HotspotCookies"));
const GenerateVouchers = lazy(() => import("@/pages/GenerateVouchers"));
const Vouchers = lazy(() => import("@/pages/Vouchers"));
const Vendors = lazy(() => import("@/pages/Vendors"));
const Reports = lazy(() => import("@/pages/Reports"));
const SalesRanking = lazy(() => import("@/pages/SalesRanking"));
const SellingReport = lazy(() => import("@/pages/SellingReport"));
const VendorPortal = lazy(() => import("@/pages/VendorPortal"));
const TicketTemplate = lazy(() => import("@/pages/TicketTemplate"));
const Managers = lazy(() => import("@/pages/Managers"));
const Collaborateurs = lazy(() => import("@/pages/Collaborateurs"));
const VendorTracking = lazy(() => import("@/pages/VendorTracking"));
const VendorPayments = lazy(() => import("@/pages/VendorPayments"));
const DailyPayments  = lazy(() => import("@/pages/DailyPayments"));
const StockAlerts = lazy(() => import("@/pages/StockAlerts"));
const Maintenance = lazy(() => import("@/pages/Maintenance"));
const TicketLookup = lazy(() => import("@/pages/TicketLookup"));
const SuperAdmins = lazy(() => import("@/pages/SuperAdmins"));
const NotFound = lazy(() => import("@/pages/not-found"));

function PageSkeleton() {
  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="skeleton h-7 w-48 rounded-md" />
        <div className="skeleton h-8 w-24 rounded-md" />
      </div>
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
  const { isAuthenticated, role, isSuperAdmin } = useAuth();
  const [routeReloadToken, setRouteReloadToken] = useState(0);
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

  useEffect(() => {
    prevLocationRef.current = location;
  }, [location]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const normalized = location.toLowerCase();
    const isDashboardish =
      normalized === "/" ||
      normalized.startsWith("/admin") ||
      normalized.startsWith("/dashboard");
    const routerRaw = localStorage.getItem("vouchernet_router_id");
    const routerId = routerRaw ? Number.parseInt(routerRaw, 10) : NaN;
    if (!Number.isFinite(routerId) || !isDashboardish) return;

    // Pre-warm dashboard hotspot logs cache so the first paint can be instant.
    // Must match Dashboard.tsx `useListRouterLogs` params + query key.
    const LS_KEY = "vouchernet-dashboard-logs-cache:v2";
    const dashLogsParams = {
      limit: 120,
      topics: "hotspot",
      live: "1" as const,
      hotspotUsers: "1" as const,
    };
    const qk = getListRouterLogsQueryKey(routerId, dashLogsParams);
    void (async () => {
      try {
        const logs = await listRouterLogs(routerId, dashLogsParams);
        qc.setQueryData(qk, logs);
        try {
          localStorage.setItem(`${LS_KEY}:${routerId}`, JSON.stringify({ ts: Date.now(), logs }));
        } catch {
          // ignore quota / private mode
        }
      } catch {
        // ignore — dashboard will still fetch normally
      }
    })();
  }, [isAuthenticated, location, qc]);

  if (location === "/vendor-portal" || location.startsWith("/vendor-portal/")) {
    return <Redirect to="/vendeur" replace />;
  }

  if (location === "/login") {
    return <Redirect to="/admin" replace />;
  }

  if (!isAuthenticated) {
    const isVendorPage = location === "/vendeur" || location.startsWith("/vendeur/");
    const isAdminLoginPage = location === "/admin" || location.startsWith("/admin/");
    const isChoosePage = location === "/";

    if (!isVendorPage && !isAdminLoginPage && !isChoosePage) {
      return <Redirect to="/admin" replace />;
    }

    const loginMode = isVendorPage ? "vendor" : isChoosePage ? "choose" : "admin";
    return (
      <PageErrorBoundary key={location}>
        <Suspense fallback={null}>
          <LoginPage mode={loginMode} />
        </Suspense>
      </PageErrorBoundary>
    );
  }

  if (role === "vendor") {
    return (
      <PageErrorBoundary key={location}>
        <Suspense fallback={<div className="flex-1 flex items-center justify-center"><PageSkeleton /></div>}>
          <VendorPortal />
        </Suspense>
      </PageErrorBoundary>
    );
  }

  return (
    <RouterProvider>
      <Layout>
        <PageErrorBoundary key={location}>
          <Suspense fallback={<PageSkeleton />}>
            <Switch key={`${location}:${routeReloadToken}`}>
              <Route path="/" component={Dashboard} />
              <Route path="/admin" component={Dashboard} />
              <Route path="/vendeur" component={Dashboard} />
              <Route path="/routers" component={role === "manager" ? Dashboard : Routers} />
              <Route path="/forfaits" component={Forfaits} />
              <Route path="/sessions" component={Sessions} />
              <Route path="/ip-bindings" component={IpBindings} />
              <Route path="/dhcp-leases" component={DhcpLeases} />
              <Route path="/hotspot-cookies" component={HotspotCookies} />
              <Route path="/generate" component={GenerateVouchers} />
              <Route path="/vouchers" component={Vouchers} />
              <Route path="/vendors" component={Vendors} />
              <Route path="/reports" component={Reports} />
              <Route path="/sales/daily" component={() => <SalesRanking period="daily" />} />
              <Route path="/sales/monthly" component={() => <SalesRanking period="monthly" />} />
              <Route path="/sales/report" component={SellingReport} />
              <Route path="/vendors/tracking" component={VendorTracking} />
              <Route path="/vendors/versements" component={VendorPayments} />
              <Route path="/vendors/versement-du-jour" component={DailyPayments} />
              <Route path="/ticket-template" component={role === "admin" ? TicketTemplate : Dashboard} />
              <Route path="/managers" component={role === "admin" ? Managers : Dashboard} />
              <Route path="/collaborateurs" component={role === "admin" ? Collaborateurs : Dashboard} />
              <Route path="/stock-alerts" component={StockAlerts} />
              <Route path="/maintenance" component={role === "admin" ? Maintenance : Dashboard} />
              <Route path="/ticket-lookup" component={TicketLookup} />
              <Route path="/super/admins" component={isSuperAdmin ? SuperAdmins : Dashboard} />
              <Route component={NotFound} />
            </Switch>
          </Suspense>
        </PageErrorBoundary>
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
            <SessionLifecycle />
            <AppRoutes />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
        <Sonner position="top-center" richColors closeButton />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
