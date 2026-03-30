import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useGetVouchers, 
  getGetVouchersQueryKey, 
  useGetProfiles,
  getGetProfilesQueryKey,
  useGenerateVouchers,
  useDeleteVoucher,
  GetVouchersStatus
} from "@workspace/api-client-react";
import { formatCurrency, formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, FilterX } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";

export default function Vouchers() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [statusFilter, setStatusFilter] = useState<GetVouchersStatus | "all">("all");
  const [profileFilter, setProfileFilter] = useState<string>("all");
  const [isGenerateOpen, setIsGenerateOpen] = useState(false);
  
  // Form state for generator
  const [genProfileId, setGenProfileId] = useState<string>("");
  const [genQuantity, setGenQuantity] = useState<string>("10");

  const { data: profiles } = useGetProfiles({
    query: { queryKey: getGetProfilesQueryKey() }
  });

  const queryParams = {
    ...(statusFilter !== "all" ? { status: statusFilter as GetVouchersStatus } : {}),
    ...(profileFilter !== "all" ? { profileId: parseInt(profileFilter) } : {})
  };

  const { data: vouchers, isLoading } = useGetVouchers(queryParams, {
    query: { queryKey: getGetVouchersQueryKey(queryParams) }
  });

  const generateVouchers = useGenerateVouchers();
  const deleteVoucher = useDeleteVoucher();

  const handleGenerate = () => {
    if (!genProfileId || !genQuantity) return;
    
    generateVouchers.mutate({
      data: {
        profileId: parseInt(genProfileId),
        quantity: parseInt(genQuantity)
      }
    }, {
      onSuccess: (res) => {
        toast({
          title: "Vouchers générés",
          description: `${res.count} vouchers ont été créés avec succès.`,
        });
        setIsGenerateOpen(false);
        queryClient.invalidateQueries({ queryKey: getGetVouchersQueryKey() });
      },
      onError: () => {
        toast({
          variant: "destructive",
          title: "Erreur",
          description: "Impossible de générer les vouchers.",
        });
      }
    });
  };

  const handleDelete = (id: number) => {
    if (!confirm("Voulez-vous vraiment supprimer ce voucher ?")) return;
    
    deleteVoucher.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Voucher supprimé" });
        queryClient.invalidateQueries({ queryKey: getGetVouchersQueryKey() });
      }
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'available': return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-900';
      case 'sold': return 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-200 dark:border-green-900';
      case 'used': return 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-900';
      case 'expired': return 'bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-800';
      default: return '';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'available': return 'Disponible';
      case 'sold': return 'Vendu';
      case 'used': return 'Utilisé';
      case 'expired': return 'Expiré';
      default: return status;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Gestion des Vouchers</h1>
          <p className="text-muted-foreground mt-1">Générez et consultez votre stock de codes d'accès.</p>
        </div>
        
        <Dialog open={isGenerateOpen} onOpenChange={setIsGenerateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Générer en lot
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Générer des vouchers</DialogTitle>
              <DialogDescription>
                Créez une série de codes aléatoires prêts à être vendus pour un forfait donné.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="profile">Forfait</Label>
                <Select value={genProfileId} onValueChange={setGenProfileId}>
                  <SelectTrigger id="profile">
                    <SelectValue placeholder="Sélectionner un forfait" />
                  </SelectTrigger>
                  <SelectContent>
                    {profiles?.map(p => (
                      <SelectItem key={p.id} value={p.id.toString()}>
                        {p.name} — {formatCurrency(p.price)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="qty">Quantité à générer</Label>
                <Input 
                  id="qty" 
                  type="number" 
                  min="1" 
                  max="1000" 
                  value={genQuantity}
                  onChange={(e) => setGenQuantity(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsGenerateOpen(false)}>Annuler</Button>
              <Button 
                onClick={handleGenerate} 
                disabled={generateVouchers.isPending || !genProfileId}
              >
                {generateVouchers.isPending ? "Génération..." : "Générer"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-col sm:flex-row gap-4 p-4 border-b bg-muted/20">
            <div className="w-full sm:w-[200px]">
              <Select value={statusFilter} onValueChange={(val: any) => setStatusFilter(val)}>
                <SelectTrigger>
                  <SelectValue placeholder="Tous les statuts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les statuts</SelectItem>
                  <SelectItem value="available">Disponibles</SelectItem>
                  <SelectItem value="sold">Vendus</SelectItem>
                  <SelectItem value="used">Utilisés</SelectItem>
                  <SelectItem value="expired">Expirés</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-full sm:w-[250px]">
              <Select value={profileFilter} onValueChange={setProfileFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Tous les forfaits" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les forfaits</SelectItem>
                  {profiles?.map(p => (
                    <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {(statusFilter !== "all" || profileFilter !== "all") && (
              <Button 
                variant="ghost" 
                onClick={() => { setStatusFilter("all"); setProfileFilter("all"); }}
                className="gap-2 px-3 text-muted-foreground"
              >
                <FilterX className="h-4 w-4" /> Effacer
              </Button>
            )}
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Forfait</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Créé le</TableHead>
                  <TableHead>Vendu le</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-8 w-8 inline-block" /></TableCell>
                    </TableRow>
                  ))
                ) : vouchers && vouchers.length > 0 ? (
                  vouchers.map((voucher) => (
                    <TableRow key={voucher.id} className="group">
                      <TableCell className="font-mono font-medium">{voucher.code}</TableCell>
                      <TableCell className="font-medium">{voucher.profileName}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={getStatusColor(voucher.status)}>
                          {getStatusLabel(voucher.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{formatDate(voucher.createdAt)}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {voucher.soldAt ? formatDate(voucher.soldAt) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive hover:bg-destructive/10 transition-opacity"
                          onClick={() => handleDelete(voucher.id)}
                          disabled={voucher.status !== 'available'}
                          title={voucher.status !== 'available' ? "Impossible de supprimer un voucher déjà vendu" : "Supprimer"}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                      Aucun voucher ne correspond à vos critères.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
