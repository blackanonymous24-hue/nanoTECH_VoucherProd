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
import { formatCurrency, formatDuration, formatBytes, minutesToParts, partsToMinutes } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Wifi, Clock, Download, Upload, Database, Plus, Edit2, Trash2, Code2, Copy, Check, Server } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";

// ── RouterOS script generator ─────────────────────────────────────────────────

function sanitizeCode(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16) || 'profile';
}

function profileLabel(name: string): string {
  return name.toUpperCase().replace(/\s+/g, '-').replace(/[^A-Z0-9\-]/g, '');
}

function generateRouterOSScript(profile: {
  name: string;
  mikrotikProfile?: string | null;
  price: number;
  durationMinutes: number;
  speedDownload: number | null;
  dataLimitMb: number | null;
}): string {
  const code = profile.mikrotikProfile || sanitizeCode(profile.name);
  const dur = formatDuration(profile.durationMinutes);
  const price = Math.round(profile.price);
  const speed = profile.speedDownload != null ? profile.speedDownload * 1000 : 0;
  const dataLimit = profile.dataLimitMb != null ? String(profile.dataLimitMb) : '';
  const label = profileLabel(profile.name);

  // Build the script line by line — no JS template escaping needed for RouterOS $ variables
  const rows: string[] = [
    `:put (",${code},${price},${dur},${speed},${dataLimit},Disable,");`,
    `{`,
    `  :local comment [ /ip hotspot user get [/ip hotspot user find where name="$user"] comment];`,
    `  :local ucode [:pic $comment 0 2];`,
    `  :if ($ucode = "vc" or $ucode = "up" or $comment = "") do={`,
    `    :local date [ /system clock get date ];`,
    `    :local year [ :pick $date 0 4 ];`,
    `    :local month [ :pick $date 5 7 ];`,
    `    /sys sch add name="$user" disable=no start-date=$date interval="${dur}";`,
    `    :delay 5s;`,
    `    :local exp [ /sys sch get [ /sys sch find where name="$user" ] next-run];`,
    `    :local getxp [len $exp];`,
    `    :if ($getxp = 15) do={ :local d [:pic $exp 0 6]; :local t [:pic $exp 7 16]; :local s ("/"); :local exp ("$d$s$year $t"); /ip hotspot user set comment="$exp" [find where name="$user"];};`,
    `    :if ($getxp = 8) do={ /ip hotspot user set comment="$date $exp" [find where name="$user"];};`,
    `    :if ($getxp > 15) do={ /ip hotspot user set comment="$exp" [find where name="$user"];};`,
    `    :delay 5s;`,
    `    /sys sch remove [find where name="$user"];`,
    `    :local mac $"mac-address";`,
    `    :local time [/system clock get time ];`,
    `    /system script add name="$date-|-$time-|-$user-|-${price}-|-$address-|-$mac-|-${dur}-|-${label}-|-$comment" owner="$month$year" source="$date" comment="mikhmon"`,
    `  }`,
    `}`,
  ];
  return rows.join('\n');
}

function ScriptDialog({ profile }: {
  profile: { name: string; mikrotikProfile?: string | null; price: number; durationMinutes: number; speedDownload: number | null; dataLimitMb: number | null }
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const script = generateRouterOSScript(profile);

  const handleCopy = () => {
    navigator.clipboard.writeText(script).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={() => setOpen(true)}>
        <Code2 className="h-4 w-4" /> Script
      </Button>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Script RouterOS — {profile.name}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-2">
          Copiez ce script dans le champ <strong>On Login</strong> du profil hotspot MikroTik correspondant à ce forfait.
        </p>
        <div className="relative">
          <Textarea
            readOnly
            className="font-mono text-xs h-72 resize-none bg-muted/50"
            value={script}
          />
          <Button
            size="sm"
            variant="secondary"
            className="absolute top-2 right-2 gap-1.5 h-7 text-xs"
            onClick={handleCopy}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copié !" : "Copier"}
          </Button>
        </div>
        <div className="text-xs text-muted-foreground space-y-1 border rounded-md p-3 bg-muted/30">
          <p><strong>Profil MikroTik :</strong> {profile.mikrotikProfile || sanitizeCode(profile.name)}</p>
          <p><strong>Prix :</strong> {Math.round(profile.price)} FCFA</p>
          <p><strong>Validité :</strong> {formatDuration(profile.durationMinutes)}</p>
          <p><strong>Vitesse :</strong> {profile.speedDownload != null ? `${profile.speedDownload * 1000} kbps` : 'Illimitée (0)'}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const profileSchema = z.object({
  name: z.string().min(1, "Nom requis"),
  mikrotikProfile: z.string().optional().nullable(),
  price: z.coerce.number().min(0, "Prix invalide"),
  durationValue: z.coerce.number().min(1, "Durée invalide"),
  durationUnit: z.enum(['m', 'd', 'w']),
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
      mikrotikProfile: "",
      price: 0,
      durationValue: 1,
      durationUnit: 'd',
      speedDownload: null,
      speedUpload: null,
      dataLimitMb: null,
      description: "",
    },
  });

  // Auto-fill mikrotikProfile from name when creating
  const watchName = form.watch("name");
  const watchMikrotikProfile = form.watch("mikrotikProfile");

  const handleOpenCreate = () => {
    setEditingId(null);
    form.reset({
      name: "",
      mikrotikProfile: "",
      price: 0,
      durationValue: 1,
      durationUnit: 'd',
      speedDownload: null,
      speedUpload: null,
      dataLimitMb: null,
      description: "",
    });
    setDialogOpen(true);
  };

  const handleOpenEdit = (profile: any) => {
    setEditingId(profile.id);
    const { value, unit } = minutesToParts(profile.durationMinutes);
    form.reset({
      name: profile.name,
      mikrotikProfile: profile.mikrotikProfile ?? sanitizeCode(profile.name),
      price: profile.price,
      durationValue: value,
      durationUnit: unit,
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
    const mProfile = (data.mikrotikProfile || "").trim() || sanitizeCode(data.name);
    const payload = {
      name: data.name,
      mikrotikProfile: mProfile,
      price: data.price,
      durationMinutes: partsToMinutes(data.durationValue, data.durationUnit),
      speedDownload: data.speedDownload ?? null,
      speedUpload: data.speedUpload ?? null,
      dataLimitMb: data.dataLimitMb || null,
      description: data.description || null,
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
                <div className="flex items-center gap-3 text-muted-foreground">
                  <Server className="h-4 w-4 shrink-0" />
                  <span className="font-mono text-xs text-foreground bg-muted px-1.5 py-0.5 rounded">
                    {profile.mikrotikProfile || sanitizeCode(profile.name)}
                  </span>
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
              <CardFooter className="bg-muted/20 pt-4 flex justify-between gap-2 border-t">
                <ScriptDialog profile={profile} />
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" className="h-8" onClick={() => handleOpenEdit(profile)}>
                    <Edit2 className="h-4 w-4 mr-2" /> Modifier
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleDelete(profile.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
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
                        <Input
                          placeholder="Ex: 1 Heure Illimité"
                          {...field}
                          onChange={(e) => {
                            field.onChange(e);
                            // Auto-fill mikrotikProfile only if still empty / was auto-generated
                            if (!editingId || !watchMikrotikProfile) {
                              form.setValue("mikrotikProfile", sanitizeCode(e.target.value));
                            }
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="mikrotikProfile"
                  render={({ field }) => (
                    <FormItem className="col-span-2">
                      <FormLabel>
                        Profil MikroTik
                        <span className="text-muted-foreground font-normal ml-1">— nom du profil hotspot RouterOS</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder={sanitizeCode(watchName || "") || "ex: 1heure"}
                          {...field}
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(e.target.value.toLowerCase().replace(/[^a-z0-9\-_]/g, ""))}
                        />
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
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium leading-none">Validité</label>
                  <div className="flex gap-2">
                    <FormField
                      control={form.control}
                      name="durationValue"
                      render={({ field }) => (
                        <FormControl>
                          <Input type="number" min="1" className="w-24" {...field} />
                        </FormControl>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="durationUnit"
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger className="w-28">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="m">m — minutes</SelectItem>
                            <SelectItem value="d">d — jours</SelectItem>
                            <SelectItem value="w">w — semaines</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </div>
                </div>
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
