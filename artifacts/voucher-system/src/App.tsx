import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Shell } from "@/components/layout/shell";
import { VendorAuthProvider, useVendorAuth } from "@/context/vendor-auth";

import Dashboard from "@/pages/dashboard";
import POS from "@/pages/pos";
import Vouchers from "@/pages/vouchers";
import Profiles from "@/pages/profiles";
import Sales from "@/pages/sales";
import Distributors from "@/pages/distributors";
import DistributorsDaily from "@/pages/distributors-daily";
import VendorLogin from "@/pages/vendor-login";
import VendorPOS from "@/pages/vendor-pos";
import SettingsRouterOS from "@/pages/settings-routeros";

const queryClient = new QueryClient();

function VendorRoute({ component: Component }: { component: React.ComponentType }) {
  const { isLoggedIn } = useVendorAuth();
  if (!isLoggedIn) return <Redirect to="/vendeur" />;
  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/vendeur" component={VendorLogin} />
      <Route path="/vendeur/vente">
        <VendorRoute component={VendorPOS} />
      </Route>
      <Route>
        <Shell>
          <Switch>
            <Route path="/">
              <Redirect to="/dashboard" />
            </Route>
            <Route path="/dashboard" component={Dashboard} />
            <Route path="/vente" component={POS} />
            <Route path="/vouchers" component={Vouchers} />
            <Route path="/profils" component={Profiles} />
            <Route path="/ventes" component={Sales} />
            <Route path="/distributeurs" component={Distributors} />
            <Route path="/distributeurs/journalier" component={DistributorsDaily} />
            <Route path="/parametres/routeros" component={SettingsRouterOS} />
            <Route component={NotFound} />
          </Switch>
        </Shell>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <VendorAuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
        </VendorAuthProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
