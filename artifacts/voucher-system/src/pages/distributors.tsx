import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetDistributors,
  getGetDistributorsQueryKey,
  useCreateDistributor,
  useUpdateDistributor,
  useDeleteDistributor,
  useGetDistributorDailyStats,
  getGetDistributorDailyStatsQueryKey,
  Distributor
} from "@workspace/api-client-react";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Edit2, Trash2, Users, Search, Activity, Wallet, KeyRound } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const distributorFormSchema = z.object({
  name: z.string().min(2, "Le nom est requis (min 2 caractères)"),
  phone: z.string().optional(),
  email: z.string().email("Email invalide").optional().or(z.literal("")),
  pin: z.string().min(4, "Le PIN doit comporter au moins 4 caractères").optional().or(z.literal("")),
  status: z.enum(["active", "inactive"]),
});

type DistributorFormValues = z.infer<typeof distributorFormSchema>;

export default function Distributors() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingDistributor, setEditingDistributor] = useState<Distributor | null>(null);
  const [deletingDistributor, setDeletingDistributor] = useState<Distributor | null>(null);
  const [viewingDistributorId, setViewingDistributorId] = useState<number | null>(null);

  const { data: distributors, isLoading } = useGetDistributors({
    query: { queryKey: getGetDistributorsQueryKey() }
  });

  const createDistributor = useCreateDistributor();
  const updateDistributor = useUpdateDistributor();
  const deleteDistributor = useDeleteDistributor();

  const form = useForm<DistributorFormValues>({
    resolver: zodResolver(distributorFormSchema),
    defaultValues: {
      name: "",
      phone: "",
      email: "",
      status: "active",
    },
  });

  const onSubmit = (data: DistributorFormValues) => {
    const payload = {
      name: data.name,
      phone: data.phone || null,
      email: data.email || null,
      pin: data.pin || null,
      status: data.status as "active" | "inactive",
    };

    if (editingDistributor) {
      updateDistributor.mutate(
        { id: editingDistributor.id, data: payload },
        {
          onSuccess: () => {
            toast({ title: "Distributeur modifié" });
            queryClient.invalidateQueries({ queryKey: getGetDistributorsQueryKey() });
            setEditingDistributor(null);
          },
          onError: () => {
            toast({ variant: "destructive", title: "Erreur lors de la modification" });
          }
        }
      );
    } else {
      createDistributor.mutate(
        { data: payload },
        {
          onSuccess: () => {
            toast({ title: "Distributeur créé" });
            queryClient.invalidateQueries({ queryKey: getGetDistributorsQueryKey() });
            setIsCreateOpen(false);
            form.reset();
          },
          onError: () => {
            toast({ variant: "destructive", title: "Erreur lors de la création" });
          }
        }
      );
    }
  };

  const handleDelete = () => {
    if (!deletingDistributor) return;
    
    deleteDistributor.mutate(
      { id: deletingDistributor.id },
      {
        onSuccess: () => {
          toast({ title: "Distributeur supprimé" });
          queryClient.invalidateQueries({ queryKey: getGetDistributorsQueryKey() });
          setDeletingDistributor(null);
        },
        onError: () => {
          toast({ variant: "destructive", title: "Impossible de supprimer ce distributeur (des ventes y sont probablement liées)" });
          setDeletingDistributor(null);
        }
      }
    );
  };

  const openEdit = (distributor: Distributor) => {
    form.reset({
      name: distributor.name,
      phone: distributor.phone || "",
      email: distributor.email || "",
      pin: distributor.pin || "",
      status: distributor.status,
    });
    setEditingDistributor(distributor);
  };

  const filteredDistributors = distributors?.filter(d => 
    d.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    (d.phone && d.phone.includes(searchQuery))
  ) || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Distributeurs</h1>
          <p className="text-muted-foreground mt-1">Gérez votre réseau de vendeurs.</p>
        </div>
        <Button onClick={() => { form.reset(); setIsCreateOpen(true); }} className="gap-2">
          <Plus className="h-4 w-4" /> Nouveau distributeur
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center space-x-2">
            <Search className="w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher par nom ou téléphone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="max-w-sm border-0 shadow-none focus-visible:ring-0 px-0"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center">
                    <Skeleton className="h-6 w-full max-w-md mx-auto" />
                  </TableCell>
                </TableRow>
              ) : filteredDistributors.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                    Aucun distributeur trouvé.
                  </TableCell>
                </TableRow>
              ) : (
                filteredDistributors.map((distributor) => (
                  <TableRow key={distributor.id}>
                    <TableCell className="font-medium">{distributor.name}</TableCell>
                    <TableCell>
                      <div className="text-sm">{distributor.phone || "—"}</div>
                      <div className="text-xs text-muted-foreground">{distributor.email}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={distributor.status === "active" ? "default" : "secondary"} className={distributor.status === "active" ? "bg-green-500 hover:bg-green-600" : ""}>
                        {distributor.status === "active" ? "Actif" : "Inactif"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => setViewingDistributorId(distributor.id)}>
                          <Activity className="h-4 w-4 mr-2" /> Stats
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => openEdit(distributor)}>
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setDeletingDistributor(distributor)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Dialog for Create / Edit */}
      <Dialog open={isCreateOpen || !!editingDistributor} onOpenChange={(open) => {
        if (!open) {
          setIsCreateOpen(false);
          setEditingDistributor(null);
        }
      }}>
        <DialogContent className="sm:max-w-[425px]">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <DialogHeader>
                <DialogTitle>{editingDistributor ? "Modifier" : "Ajouter"} un distributeur</DialogTitle>
                <DialogDescription>
                  Renseignez les informations du distributeur.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nom</FormLabel>
                      <FormControl>
                        <Input placeholder="Boutique Centrale" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Téléphone</FormLabel>
                      <FormControl>
                        <Input placeholder="+261 34 00 000 00" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email (Optionnel)</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="contact@boutique.com" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="pin"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1">
                        <KeyRound className="h-3.5 w-3.5" /> Code PIN vendeur
                      </FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="4 chiffres minimum" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Statut</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Sélectionnez un statut" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="active">Actif</SelectItem>
                          <SelectItem value="inactive">Inactif</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setIsCreateOpen(false); setEditingDistributor(null); }}>
                  Annuler
                </Button>
                <Button type="submit" disabled={createDistributor.isPending || updateDistributor.isPending}>
                  {editingDistributor ? "Enregistrer" : "Créer"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* AlertDialog for Delete */}
      <AlertDialog open={!!deletingDistributor} onOpenChange={(open) => !open && setDeletingDistributor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce distributeur ?</AlertDialogTitle>
            <AlertDialogDescription>
              Êtes-vous sûr de vouloir supprimer "{deletingDistributor?.name}" ? Cette action est irréversible. S'il a déjà effectué des ventes, la suppression pourrait être bloquée.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDelete} disabled={deleteDistributor.isPending}>
              {deleteDistributor.isPending ? "Suppression..." : "Supprimer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialog for Stats */}
      <DistributorStatsDialog 
        distributorId={viewingDistributorId} 
        onClose={() => setViewingDistributorId(null)} 
      />
    </div>
  );
}

function DistributorStatsDialog({ distributorId, onClose }: { distributorId: number | null, onClose: () => void }) {
  const { data: stats, isLoading } = useGetDistributorDailyStats(
    distributorId || 0,
    {
      query: { 
        queryKey: getGetDistributorDailyStatsQueryKey(distributorId || 0),
        enabled: !!distributorId
      }
    }
  );

  return (
    <Dialog open={!!distributorId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Statistiques du Distributeur</DialogTitle>
          <DialogDescription>
            Performances détaillées de ce point de vente.
          </DialogDescription>
        </DialogHeader>
        
        {isLoading ? (
          <div className="space-y-4 py-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : stats ? (
          <div className="space-y-6 py-4">
            <h3 className="text-lg font-bold text-center border-b pb-4">{stats.distributorName}</h3>
            
            <div className="grid grid-cols-2 gap-4">
              <Card className="bg-primary/5 border-primary/20">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Wallet className="h-4 w-4 text-primary" /> Aujourd'hui
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="text-2xl font-bold text-primary">{formatCurrency(stats.revenueToday)}</div>
                  <p className="text-xs text-muted-foreground mt-1">{stats.vouchersSoldToday} vouchers</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
                    <Activity className="h-4 w-4" /> Global (Total)
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="text-xl font-bold">{formatCurrency(stats.revenueTotal)}</div>
                  <p className="text-xs text-muted-foreground mt-1">{stats.vouchersSoldTotal} vouchers</p>
                </CardContent>
              </Card>
            </div>
          </div>
        ) : (
          <div className="py-8 text-center text-muted-foreground">
            Aucune donnée disponible.
          </div>
        )}
        
        <DialogFooter>
          <Button onClick={onClose}>Fermer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
