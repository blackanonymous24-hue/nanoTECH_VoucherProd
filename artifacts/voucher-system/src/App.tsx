import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Shell } from "@/components/layout/shell";

import Dashboard from "@/pages/dashboard";
import POS from "@/pages/pos";
import Vouchers from "@/pages/vouchers";
import Profiles from "@/pages/profiles";
import Sales from "@/pages/sales";
import Distributors from "@/pages/distributors";
import DistributorsDaily from "@/pages/distributors-daily";

const queryClient = new QueryClient();

function Router() {
  return (
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
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
