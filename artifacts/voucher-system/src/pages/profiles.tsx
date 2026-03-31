import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { 
  useGetProfiles, 
  getGetProfilesQueryKey,
  useCreateProfile,
  useUpdateProfile,
  useDeleteProfile
} from "@workspace/api-client-react";
import { formatCurrency, formatDuration, formatBytes } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Wifi, Clock, Download, Upload, Database, Plus, Edit2, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";

const profileSchema = z.object({
  name: z.string().min(1, "Nom requis"),
  price: z.coerce.number().min(0, "Prix invalide"),
  durationMinutes: z.coerce.number().min(1, "Durée invalide"),
  speedDownload: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().int().positive("Doit être positif").nullable().optional()
  ),
  speedUpload: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().int().positive("Doit être positif").nullable().optional()
  ),
  dataLimitMb: z.coerce.number().optional().nullable(),
  description: z.string().optional().nullable(),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

export default function Profiles() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const { data: profiles, isLoading } = useGetProfiles({
    query: { queryKey: getGetProfilesQueryKey() }
  });

  const createProfile = useCreateProfile();
  const updateProfile = useUpdateProfile();
  const deleteProfile = useDeleteProfile();

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: "",
      price: 0,
      durationMinutes: 60,
      speedDownload: null,
      speedUpload: null,
      dataLimitMb: null,
      description: "",
    },
  });

  const handleOpenCreate = () => {
    setEditingId(null);
    form.reset({
      name: "",
      price: 0,
      durationMinutes: 60,
      speedDownload: null,
      speedUpload: null,
      dataLimitMb: null,
      description: "",
    });
    setDialogOpen(true);
  };

  const handleOpenEdit = (profile: any) => {
    setEditingId(profile.id);
    form.reset({
      name: profile.name,
      price: profile.price,
      durationMinutes: profile.durationMinutes,
      speedDownload: profile.speedDownload ?? null,
      speedUpload: profile.speedUpload ?? null,
      dataLimitMb: profile.dataLimitMb,
      description: profile.description,
    });
    setDialogOpen(true);
  };

  const handleDelete = (id: number) => {
    if (!confirm("Voulez-vous vraiment supprimer ce forfait ?")) return;
    deleteProfile.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Forfait supprimé" });
        queryClient.invalidateQueries({ queryKey: getGetProfilesQueryKey() });
      },
      onError: () => {
        toast({ variant: "destructive", title: "Erreur", description: "Impossible de supprimer ce forfait s'il est utilisé." });
      }
    });
  };

  const onSubmit = (data: ProfileFormValues) => {
    const payload = {
      ...data,
      speedDownload: data.speedDownload ?? null,
      speedUpload: data.speedUpload ?? null,
      dataLimitMb: data.dataLimitMb || null,
    };

    if (editingId) {
      updateProfile.mutate({ id: editingId, data: payload }, {
        onSuccess: () => {
          toast({ title: "Forfait modifié" });
          setDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: getGetProfilesQueryKey() });
        }
      });
    } else {
      createProfile.mutate({ data: payload }, {
        onSuccess: () => {
          toast({ title: "Forfait créé" });
          setDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: getGetProfilesQueryKey() });
        }
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Forfaits & Profils</h1>
          <p className="text-muted-foreground mt-1">Configurez les offres internet liées à votre routeur MikroTik.</p>
        </div>
        <Button onClick={handleOpenCreate} className="gap-2">
          <Plus className="h-4 w-4" /> Nouveau Forfait
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="overflow-hidden">
              <CardHeader className="pb-4">
                <Skeleton className="h-6 w-1/2 mb-2" />
                <Skeleton className="h-8 w-1/3" />
              </CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-4 w-full" />
              </CardContent>
            </Card>
          ))
        ) : profiles && profiles.length > 0 ? (
          profiles.map((profile) => (
            <Card key={profile.id} className="flex flex-col hover:border-primary/50 transition-colors">
              <CardHeader className="pb-4">
                <CardTitle className="text-xl">{profile.name}</CardTitle>
                <div className="text-2xl font-bold text-primary">{formatCurrency(profile.price)}</div>
                {profile.description && (
                  <CardDescription>{profile.description}</CardDescription>
                )}
              </CardHeader>
              <CardContent className="flex-1 space-y-3 text-sm">
                <div className="flex items-center gap-3 text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  <span>Durée : <strong className="text-foreground">{formatDuration(profile.durationMinutes)}</strong></span>
                </div>
                {profile.speedDownload != null && (
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <Download className="h-4 w-4" />
                    <span>Download : <strong className="text-foreground">{profile.speedDownload} Mbps</strong></span>
                  </div>
                )}
                {profile.speedUpload != null && (
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <Upload className="h-4 w-4" />
                    <span>Upload : <strong className="text-foreground">{profile.speedUpload} Mbps</strong></span>
                  </div>
                )}
                {profile.speedDownload == null && profile.speedUpload == null && (
                  <div className="flex items-center gap-3 text-muted-foreground">
                    <Wifi className="h-4 w-4" />
                    <span>Vitesse illimitée</span>
                  </div>
                )}
                <div className="flex items-center gap-3 text-muted-foreground">
                  <Database className="h-4 w-4" />
                  <span>Quota : <strong className="text-foreground">{formatBytes(profile.dataLimitMb)}</strong></span>
                </div>
              </CardContent>
              <CardFooter className="bg-muted/20 pt-4 flex justify-end gap-2 border-t">
                <Button variant="ghost" size="sm" className="h-8" onClick={() => handleOpenEdit(profile)}>
                  <Edit2 className="h-4 w-4 mr-2" /> Modifier
                </Button>
                <Button variant="ghost" size="sm" className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDelete(profile.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardFooter>
            </Card>
          ))
        ) : (
          <div className="col-span-full py-12 text-center text-muted-foreground bg-muted/10 rounded-xl border border-dashed">
            <Wifi className="h-12 w-12 mx-auto mb-4 opacity-20" />
            <p className="text-lg">Aucun forfait configuré.</p>
            <p className="text-sm mt-1 mb-4">Commencez par créer votre première offre.</p>
            <Button onClick={handleOpenCreate} variant="outline">Créer un forfait</Button>
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editingId ? "Modifier le forfait" : "Créer un nouveau forfait"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem className="col-span-2">
                      <FormLabel>Nom du forfait</FormLabel>
                      <FormControl>
                        <Input placeholder="Ex: 1 Heure Illimité" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="price"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Prix (FCFA)</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="durationMinutes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Durée (minutes)</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="speedDownload"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Download (Mbps) <span className="text-muted-foreground font-normal">— optionnel</span></FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="Illimité"
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="speedUpload"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Upload (Mbps) <span className="text-muted-foreground font-normal">— optionnel</span></FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="Illimité"
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="dataLimitMb"
                  render={({ field }) => (
                    <FormItem className="col-span-2">
                      <FormLabel>Quota données (Mo) <span className="text-muted-foreground font-normal">— optionnel</span></FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="Laissez vide pour illimité"
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem className="col-span-2">
                      <FormLabel>Description <span className="text-muted-foreground font-normal">— optionnel</span></FormLabel>
                      <FormControl>
                        <Input placeholder="Ex: Idéal pour navigation" value={field.value ?? ""} onChange={field.onChange} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Annuler</Button>
                <Button type="submit" disabled={createProfile.isPending || updateProfile.isPending}>
                  {createProfile.isPending || updateProfile.isPending ? "Sauvegarde..." : "Enregistrer"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
