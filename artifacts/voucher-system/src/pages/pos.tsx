import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetProfiles,
  getGetProfilesQueryKey,
  useCreateSale,
  getGetVouchersQueryKey,
  getGetDashboardStatsQueryKey,
  getGetRecentSalesQueryKey,
  getGetVouchersByProfileQueryKey
} from "@workspace/api-client-react";
import { formatCurrency, formatDuration, formatBytes } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Wifi, CreditCard, Banknote, Printer, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const saleFormSchema = z.object({
  profileId: z.number({ required_error: "Veuillez sélectionner un forfait" }),
  paymentMethod: z.string().min(1, "Mode de paiement requis"),
  customerName: z.string().optional(),
  operatorName: z.string().optional(),
});

type SaleFormValues = z.infer<typeof saleFormSchema>;

export default function POS() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [successSale, setSuccessSale] = useState<{ voucherCode: string, profileName: string, amount: number } | null>(null);

  const { data: profiles, isLoading: isLoadingProfiles } = useGetProfiles({
    query: { queryKey: getGetProfilesQueryKey() }
  });

  const createSale = useCreateSale();

  const form = useForm<SaleFormValues>({
    resolver: zodResolver(saleFormSchema),
    defaultValues: {
      paymentMethod: "Espèces",
      customerName: "",
      operatorName: "Admin",
    },
  });

  const onSubmit = (data: SaleFormValues) => {
    createSale.mutate({ data }, {
      onSuccess: (sale) => {
        setSuccessSale({
          voucherCode: sale.voucherCode,
          profileName: sale.profileName,
          amount: sale.amount
        });
        toast({
          title: "Vente réussie",
          description: "Le voucher a été généré et assigné avec succès.",
        });
        
        // Invalidate queries to refresh dashboard and lists
        queryClient.invalidateQueries({ queryKey: getGetVouchersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardStatsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetRecentSalesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetVouchersByProfileQueryKey() });
        
        form.reset({
          profileId: data.profileId, // Keep same profile selected
          paymentMethod: data.paymentMethod,
          operatorName: data.operatorName,
          customerName: ""
        });
      },
      onError: (error: any) => {
        toast({
          variant: "destructive",
          title: "Erreur lors de la vente",
          description: error.message || "Impossible de réaliser la vente. Vérifiez s'il reste des vouchers disponibles pour ce forfait.",
        });
      }
    });
  };

  const handleNewSale = () => {
    setSuccessSale(null);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Point de Vente</h1>
        <p className="text-muted-foreground mt-1">Vendez rapidement un accès Wi-Fi.</p>
      </div>

      {successSale ? (
        <Card className="border-primary bg-primary/5">
          <CardContent className="pt-10 pb-8 flex flex-col items-center justify-center text-center space-y-6">
            <div className="h-20 w-20 bg-primary/20 rounded-full flex items-center justify-center">
              <CheckCircle2 className="h-10 w-10 text-primary" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold">Vente validée !</h2>
              <p className="text-muted-foreground">
                {successSale.profileName} — {formatCurrency(successSale.amount)}
              </p>
            </div>
            
            <div className="bg-card border-2 border-dashed border-primary/50 rounded-xl p-8 w-full max-w-sm">
              <p className="text-sm text-muted-foreground uppercase tracking-widest mb-2">Code d'accès</p>
              <div className="text-4xl md:text-5xl font-mono font-bold tracking-wider text-foreground">
                {successSale.voucherCode}
              </div>
            </div>

            <div className="flex gap-4 pt-4">
              <Button onClick={() => window.print()} variant="outline" className="gap-2">
                <Printer className="h-4 w-4" />
                Imprimer
              </Button>
              <Button onClick={handleNewSale} className="gap-2">
                Nouvelle vente
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            <div className="md:col-span-2 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>1. Choix du Forfait</CardTitle>
                  <CardDescription>Sélectionnez le forfait à vendre.</CardDescription>
                </CardHeader>
                <CardContent>
                  {isLoadingProfiles ? (
                    <div className="grid grid-cols-2 gap-4">
                      <Skeleton className="h-32 w-full" />
                      <Skeleton className="h-32 w-full" />
                    </div>
                  ) : profiles && profiles.length > 0 ? (
                    <FormField
                      control={form.control}
                      name="profileId"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <RadioGroup
                              onValueChange={(val) => field.onChange(parseInt(val))}
                              defaultValue={field.value?.toString()}
                              className="grid grid-cols-1 sm:grid-cols-2 gap-4"
                            >
                              {profiles.map((profile) => (
                                <FormItem key={profile.id} className="relative">
                                  <FormControl>
                                    <RadioGroupItem 
                                      value={profile.id.toString()} 
                                      className="peer sr-only" 
                                    />
                                  </FormControl>
                                  <FormLabel className="flex flex-col items-start gap-2 rounded-xl border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 cursor-pointer transition-all">
                                    <div className="flex w-full justify-between items-center">
                                      <span className="font-semibold text-lg">{profile.name}</span>
                                      <span className="font-bold text-primary">{formatCurrency(profile.price)}</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2">
                                      <Wifi className="h-4 w-4" />
                                      <span>{formatDuration(profile.durationMinutes)}</span>
                                      <span className="text-border mx-1">|</span>
                                      <span>{formatBytes(profile.dataLimitMb)}</span>
                                    </div>
                                  </FormLabel>
                                </FormItem>
                              ))}
                            </RadioGroup>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : (
                    <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-xl">
                      Aucun profil disponible. Veuillez créer un profil d'abord.
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>2. Détails & Paiement</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="customerName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nom du client (Optionnel)</FormLabel>
                        <FormControl>
                          <Input placeholder="Ex: Jean Dupont" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="paymentMethod"
                    render={({ field }) => (
                      <FormItem className="space-y-3">
                        <FormLabel>Mode de paiement</FormLabel>
                        <FormControl>
                          <RadioGroup
                            onValueChange={field.onChange}
                            defaultValue={field.value}
                            className="flex flex-col gap-2"
                          >
                            <FormItem className="flex items-center space-x-3 space-y-0 p-3 border rounded-lg hover:bg-accent cursor-pointer peer-data-[state=checked]:border-primary">
                              <FormControl>
                                <RadioGroupItem value="Espèces" />
                              </FormControl>
                              <Banknote className="h-4 w-4 text-muted-foreground" />
                              <FormLabel className="font-normal cursor-pointer flex-1">
                                Espèces
                              </FormLabel>
                            </FormItem>
                            <FormItem className="flex items-center space-x-3 space-y-0 p-3 border rounded-lg hover:bg-accent cursor-pointer peer-data-[state=checked]:border-primary">
                              <FormControl>
                                <RadioGroupItem value="Mobile Money" />
                              </FormControl>
                              <CreditCard className="h-4 w-4 text-muted-foreground" />
                              <FormLabel className="font-normal cursor-pointer flex-1">
                                Mobile Money
                              </FormLabel>
                            </FormItem>
                          </RadioGroup>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="operatorName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Opérateur</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
                <CardFooter>
                  <Button 
                    type="submit" 
                    className="w-full h-12 text-lg font-medium"
                    disabled={createSale.isPending || !form.watch("profileId")}
                  >
                    {createSale.isPending ? "Validation..." : "Valider la vente"}
                  </Button>
                </CardFooter>
              </Card>
            </div>

          </form>
        </Form>
      )}
    </div>
  );
}
