import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RouterProvider } from "@/contexts/RouterContext";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import Routers from "@/pages/Routers";
import Forfaits from "@/pages/Forfaits";
import Sessions from "@/pages/Sessions";
import GenerateVouchers from "@/pages/GenerateVouchers";
import Vouchers from "@/pages/Vouchers";
import Vendors from "@/pages/Vendors";
import Reports from "@/pages/Reports";
import SalesRanking from "@/pages/SalesRanking";
import VendorPortal from "@/pages/VendorPortal";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

function AppRoutes() {
  const [location] = useLocation();

  if (location.startsWith("/vendor-portal")) {
    return <VendorPortal />;
  }

  return (
    <RouterProvider>
      <Layout>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/routers" component={Routers} />
          <Route path="/forfaits" component={Forfaits} />
          <Route path="/sessions" component={Sessions} />
          <Route path="/generate" component={GenerateVouchers} />
          <Route path="/vouchers" component={Vouchers} />
          <Route path="/vendors" component={Vendors} />
          <Route path="/reports" component={Reports} />
          <Route path="/sales/daily" component={() => <SalesRanking period="daily" />} />
          <Route path="/sales/monthly" component={() => <SalesRanking period="monthly" />} />
          <Route component={NotFound} />
        </Switch>
      </Layout>
    </RouterProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AppRoutes />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
