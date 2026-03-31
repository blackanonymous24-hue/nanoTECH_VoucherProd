import { useState } from "react";
import { useLocation } from "wouter";
import { useVendorAuth } from "@/context/vendor-auth";
import { useGetProfiles, useCreateSale, getGetDashboardStatsQueryKey, getGetRecentSalesQueryKey, getGetVouchersByProfileQueryKey } from "@workspace/api-client-react";
import { formatCurrency, formatDuration } from "@/lib/format";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Wifi, Banknote, CreditCard, CheckCircle2, LogOut, Printer, User } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function VendorPOS() {
  const { vendor, logout } = useVendorAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState("Espèces");
  const [customerName, setCustomerName] = useState("");
  const [successSale, setSuccessSale] = useState<{ voucherCode: string; profileName: string; amount: number } | null>(null);

  const { data: profiles, isLoading } = useGetProfiles({});
  const { mutate: createSale, isPending } = useCreateSale({
    mutation: {
      onSuccess: (sale) => {
        setSuccessSale({
          voucherCode: sale.voucherCode,
          profileName: sale.profileName,
          amount: sale.amount,
        });
        setSelectedProfileId(null);
        setCustomerName("");
        setPaymentMethod("Espèces");
        queryClient.invalidateQueries({ queryKey: getGetDashboardStatsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetRecentSalesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetVouchersByProfileQueryKey() });
      },
      onError: (err: any) => {
        const msg = err?.response?.data?.error ?? "Une erreur est survenue";
        toast({ title: "Erreur de vente", description: msg, variant: "destructive" });
      },
    },
  });

  function handleLogout() {
    logout();
    navigate("/vendeur");
  }

  function handleSell() {
    if (!selectedProfileId || !vendor) return;
    createSale({
      data: {
        profileId: selectedProfileId,
        paymentMethod,
        customerName: customerName || undefined,
        distributorId: vendor.id,
      },
    });
  }

  const selectedProfile = profiles?.find((p) => p.id === selectedProfileId);

  if (successSale) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-sm text-center">
          <CardHeader className="pb-2 pt-8">
            <div className="flex justify-center mb-4">
              <CheckCircle2 className="h-16 w-16 text-green-500" />
            </div>
            <CardTitle className="text-2xl">Vente réussie</CardTitle>
            <CardDescription>{successSale.profileName}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pb-8">
            <div className="bg-muted rounded-lg p-4 space-y-2">
              <p className="text-sm text-muted-foreground">Code voucher</p>
              <p className="text-3xl font-mono font-bold tracking-widest">{successSale.voucherCode}</p>
              <p className="text-lg font-semibold text-primary">{formatCurrency(successSale.amount)}</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => window.print()}
              >
                <Printer className="h-4 w-4 mr-2" />
                Imprimer
              </Button>
              <Button
                className="flex-1"
                onClick={() => setSuccessSale(null)}
              >
                Nouvelle vente
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b bg-card px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <Wifi className="h-5 w-5 text-primary" />
          <span className="font-bold text-lg">VoucherNet</span>
          <Badge variant="secondary" className="ml-1 text-xs">Vendeur</Badge>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-sm text-right hidden sm:block">
            <p className="font-medium">{vendor?.name}</p>
            <p className="text-muted-foreground text-xs">{vendor?.phone}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            <LogOut className="h-4 w-4 mr-1" />
            <span className="hidden sm:inline">Déconnexion</span>
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="container mx-auto p-4 max-w-2xl space-y-6">
          <div>
            <h1 className="text-2xl font-bold">Point de Vente</h1>
            <p className="text-muted-foreground text-sm">Sélectionnez un forfait pour vendre un voucher</p>
          </div>

          <div className="space-y-3">
            <h2 className="font-semibold">Forfaits disponibles</h2>
            {isLoading ? (
              <div className="grid grid-cols-2 gap-3">
                <Skeleton className="h-24" />
                <Skeleton className="h-24" />
                <Skeleton className="h-24" />
                <Skeleton className="h-24" />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {profiles?.filter(p => p.bandwidth > 0 || p.durationMinutes > 0).map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    onClick={() => setSelectedProfileId(profile.id === selectedProfileId ? null : profile.id)}
                    className={`text-left p-4 rounded-lg border-2 transition-all ${
                      selectedProfileId === profile.id
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-border hover:border-primary/40 bg-card"
                    }`}
                  >
                    <div className="font-semibold">{profile.name}</div>
                    <div className="text-primary font-bold text-lg mt-1">{formatCurrency(profile.price)}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {formatDuration(profile.durationMinutes)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedProfileId && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Détails de la vente</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Mode de paiement</Label>
                  <RadioGroup value={paymentMethod} onValueChange={setPaymentMethod} className="grid grid-cols-2 gap-2">
                    {["Espèces", "Mobile Money"].map((method) => (
                      <div key={method} className={`flex items-center gap-2 border rounded-md p-3 cursor-pointer transition-colors ${paymentMethod === method ? "border-primary bg-primary/5" : "border-border"}`} onClick={() => setPaymentMethod(method)}>
                        <RadioGroupItem value={method} id={method} />
                        <Label htmlFor={method} className="cursor-pointer flex items-center gap-2">
                          {method === "Espèces" ? <Banknote className="h-4 w-4" /> : <CreditCard className="h-4 w-4" />}
                          {method}
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="customer">Nom du client (optionnel)</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="customer"
                      className="pl-9"
                      placeholder="Ex: Jean Dupont"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                    />
                  </div>
                </div>

                <div className="rounded-lg bg-muted/50 p-3 flex items-center justify-between">
                  <span className="text-sm font-medium">{selectedProfile?.name}</span>
                  <span className="text-lg font-bold text-primary">{selectedProfile ? formatCurrency(selectedProfile.price) : ""}</span>
                </div>

                <Button
                  className="w-full"
                  size="lg"
                  onClick={handleSell}
                  disabled={isPending}
                >
                  {isPending ? "Traitement..." : `Valider la vente — ${selectedProfile ? formatCurrency(selectedProfile.price) : ""}`}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
