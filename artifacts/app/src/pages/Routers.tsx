import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import {
  useListRouters,
  useCreateRouter,
  useDeleteRouter,
  useUpdateRouter,
  useTestRouterConnection,
  getListRoutersQueryKey,
} from "@workspace/api-client-react";
import type { Router as RouterType } from "@workspace/api-client-react";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Trash2, Wifi, WifiOff, Edit, KeyRound, CheckCircle2, MoreHorizontal, ArrowRight, Layers, AlertTriangle, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useRouterContext } from "@/contexts/RouterContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type RouterFormData = {
  name: string;
  hotspotName: string;
  contact: string;
  address: string;
  username: string;
  password: string;
};

const emptyForm: RouterFormData = {
  name: "",
  hotspotName: "",
  contact: "",
  address: "",
  username: "admin",
  password: "",
};

function parseAddress(address: string): { host: string; port: number } {
  const colonIdx = address.lastIndexOf(":");
  if (colonIdx > 0) {
    const portStr = address.slice(colonIdx + 1);
    if (/^\d+$/.test(portStr)) {
      return { host: address.slice(0, colonIdx), port: parseInt(portStr, 10) };
    }
  }
  return { host: address, port: 8728 };
}

function CredentialsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState({ login: "", password: "", confirm: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (form.password !== form.confirm) {
      setError("Les mots de passe ne correspondent pas");
      return;
    }
    if (!form.login.trim() || !form.password) {
      setError("Tous les champs sont obligatoires");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/admin/credentials`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ login: form.login.trim(), password: form.password }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Erreur");
        return;
      }
      toast({ title: "Identifiants mis à jour" });
      setForm({ login: "", password: "", confirm: "" });
      onClose();
    } catch {
      setError("Erreur de communication avec le serveur");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Changer les identifiants admin</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div>
            <Label>Nouvel identifiant</Label>
            <Input
              className="mt-1"
              placeholder="admin"
              value={form.login}
              onChange={(e) => setForm({ ...form, login: e.target.value })}
              required
            />
          </div>
          <div>
            <Label>Nouveau mot de passe</Label>
            <Input
              className="mt-1"
              type="password"
              placeholder="••••••••"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
            />
          </div>
          <div>
            <Label>Confirmer le mot de passe</Label>
            <Input
              className="mt-1"
              type="password"
              placeholder="••••••••"
              value={form.confirm}
              onChange={(e) => setForm({ ...form, confirm: e.target.value })}
              required
            />
          </div>
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>Annuler</Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Enregistrement..." : "Enregistrer"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type DbProfile = { profileName: string; total: number; available: number; sold: number };

function ProfileMergeDialog({ routerId, onClose }: { routerId: number; onClose: () => void }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const [dbProfiles, setDbProfiles] = useState<DbProfile[]>([]);
  const [liveNames, setLiveNames] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [merging, setMerging] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [dbRes, liveRes] = await Promise.all([
        fetch(`${BASE}/api/routers/${routerId}/profiles/db`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${BASE}/api/routers/${routerId}/profiles`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null),
      ]);
      const db: DbProfile[] = await dbRes.json();
      setDbProfiles(db);
      if (liveRes?.ok) {
        const live: { name: string }[] = await liveRes.json();
        setLiveNames(new Set(live.map((p) => p.name)));
      }
    } catch {
      toast({ title: "Erreur de chargement", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const handleMerge = async () => {
    if (!from || !to) return;
    if (!confirm(`Fusionner tous les tickets « ${from} » → « ${to} » ?\nCette action est irréversible.`)) return;
    setMerging(true);
    try {
      const res = await fetch(`${BASE}/api/routers/${routerId}/profiles/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ from, to }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast({ title: `Fusion effectuée — ${data.updated} ticket(s) mis à jour` });
      setFrom("");
      setTo("");
      await load();
    } catch (err) {
      toast({ title: "Erreur", description: err instanceof Error ? err.message : "Erreur inconnue", variant: "destructive" });
    } finally {
      setMerging(false);
    }
  };

  const orphaned = dbProfiles.filter((p) => liveNames.size > 0 && !liveNames.has(p.profileName));

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4" /> Gestion des profils — BD
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-8 text-center text-sm text-gray-400">Chargement...</div>
        ) : (
          <div className="space-y-4">
            {orphaned.length > 0 && (
              <div className="flex items-start gap-2 rounded-md bg-orange-50 border border-orange-200 px-3 py-2 text-sm text-orange-700">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>
                  <strong>{orphaned.length} profil(s)</strong> en BD absent(s) de MikroTik :{" "}
                  {orphaned.map((p) => `« ${p.profileName} »`).join(", ")}
                </span>
              </div>
            )}

            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th className="text-left px-3 py-2">Profil</th>
                    <th className="text-right px-3 py-2">Total</th>
                    <th className="text-right px-3 py-2">Dispo</th>
                    <th className="text-right px-3 py-2">Vendus</th>
                    <th className="text-center px-3 py-2">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {dbProfiles.map((p) => {
                    const isOrphaned = liveNames.size > 0 && !liveNames.has(p.profileName);
                    return (
                      <tr key={p.profileName} className={isOrphaned ? "bg-orange-50" : ""}>
                        <td className="px-3 py-2 font-mono font-medium text-gray-800">{p.profileName}</td>
                        <td className="px-3 py-2 text-right text-gray-600">{p.total}</td>
                        <td className="px-3 py-2 text-right text-emerald-600 font-semibold">{p.available}</td>
                        <td className="px-3 py-2 text-right text-gray-400">{p.sold}</td>
                        <td className="px-3 py-2 text-center">
                          {isOrphaned ? (
                            <span className="text-xs font-semibold text-orange-500">Ancien nom</span>
                          ) : (
                            <span className="text-xs text-green-600">✓ Actif</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Fusionner un profil</p>
              <div className="flex items-center gap-2">
                <Select value={from} onValueChange={setFrom}>
                  <SelectTrigger className="flex-1 text-sm h-9">
                    <SelectValue placeholder="Ancien nom..." />
                  </SelectTrigger>
                  <SelectContent>
                    {dbProfiles.map((p) => (
                      <SelectItem key={p.profileName} value={p.profileName}>{p.profileName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <ArrowRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
                <Select value={to} onValueChange={setTo}>
                  <SelectTrigger className="flex-1 text-sm h-9">
                    <SelectValue placeholder="Nom cible..." />
                  </SelectTrigger>
                  <SelectContent>
                    {dbProfiles.filter((p) => p.profileName !== from).map((p) => (
                      <SelectItem key={p.profileName} value={p.profileName}>{p.profileName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  onClick={handleMerge}
                  disabled={!from || !to || merging}
                  className="px-3 py-2 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {merging ? "..." : "Fusionner"}
                </button>
              </div>
              <p className="text-xs text-gray-400">
                Tous les tickets de l&apos;ancien nom seront rattachés au nom cible. Les tickets vendus sont conservés.
              </p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Routers() {
  const { data: routers = [], isLoading } = useListRouters();
  const createMutation = useCreateRouter();
  const deleteMutation = useDeleteRouter();
  const updateMutation = useUpdateRouter();
  const testMutation = useTestRouterConnection();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { setSelectedRouterId, selectedRouterId } = useRouterContext();
  const { role, token, isSuperAdmin } = useAuth();
  const isManager = role === "manager";
  const [, navigate] = useLocation();

  /* ── Quota & credits (admin only, regular admins see the banner) ─── */
  interface AdminMe {
    isSuperAdmin: boolean;
    credits: number;
    routerCount: number;
    routerLimit: number;
    forfaitEndsAt: string | null;
  }
  const { data: adminMe } = useQuery<AdminMe>({
    queryKey: ["admin", "me"],
    enabled: !!token && role === "admin",
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/admin/me`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error("Échec de chargement du profil");
      return r.json();
    },
  });
  const buyRoutersM = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/admin/buy-routers`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      const data = await r.json().catch(() => ({} as { error?: string }));
      if (!r.ok) throw new Error(data?.error ?? "Achat impossible");
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "me"] });
      toast({ title: "Pack acquis", description: "+5 routeurs ajoutés à votre quota." });
    },
    onError: (err) => {
      toast({
        title: "Achat impossible",
        description: err instanceof Error ? err.message : "Crédits insuffisants",
        variant: "destructive",
      });
    },
  });

  const [showForm, setShowForm] = useState(false);
  const [showCredentials, setShowCredentials] = useState(false);
  const [editRouter, setEditRouter] = useState<RouterType | null>(null);
  const [form, setForm] = useState<RouterFormData>(emptyForm);
  const [testResults, setTestResults] = useState<Record<number, { success: boolean; message: string }>>({});
  const [profileMergeRouterId, setProfileMergeRouterId] = useState<number | null>(null);
  const [forceSyncingId, setForceSyncingId] = useState<number | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListRoutersQueryKey() });

  const openCreate = () => {
    setForm(emptyForm);
    setEditRouter(null);
    setShowForm(true);
  };

  const openEdit = (r: RouterType) => {
    setForm({ name: r.name, hotspotName: (r as any).hotspotName ?? "", contact: (r as any).contact ?? "", address: `${r.host}:${r.port}`, username: r.username, password: "" });
    setEditRouter(r);
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { host, port } = parseAddress(form.address);
    if (!host) {
      toast({ title: "Adresse invalide", description: "Format attendu: ip:port ou domaine:port", variant: "destructive" });
      return;
    }
    const payload = {
      name: form.name,
      hotspotName: form.hotspotName || undefined,
      contact: form.contact || undefined,
      host,
      port,
      username: form.username,
      password: form.password,
    };
    if (editRouter) {
      await updateMutation.mutateAsync({ id: editRouter.id, data: payload });
      toast({ title: "Routeur mis à jour" });
    } else {
      await createMutation.mutateAsync({ data: payload });
      toast({ title: "Routeur ajouté" });
    }
    setShowForm(false);
    invalidate();
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Supprimer ce routeur et tous ses vouchers ?")) return;
    await deleteMutation.mutateAsync({ id });
    toast({ title: "Routeur supprimé" });
    invalidate();
  };

  const handleTest = async (id: number) => {
    try {
      const result = await testMutation.mutateAsync({ id });
      setTestResults((prev) => ({ ...prev, [id]: result }));
      toast({
        title: result.success ? "Connexion réussie" : "Connexion échouée",
        description: result.message,
        variant: result.success ? "default" : "destructive",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur de connexion";
      setTestResults((prev) => ({ ...prev, [id]: { success: false, message } }));
      toast({ title: "Connexion échouée", description: message, variant: "destructive" });
    }
  };

  const handleForceSync = async (id: number) => {
    setForceSyncingId(id);
    try {
      const res = await fetch(`/api/admin/routers/${id}/force-sync`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erreur");
      toast({
        title: "Resync complet terminé",
        description: `${data.scriptInserted} nouvelles entrées script · ${data.vouchersCreated} ticket(s) récupéré(s)`,
      });
    } catch (err) {
      toast({ title: "Resync échoué", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setForceSyncingId(null);
    }
  };

  const handleSelect = (id: number) => {
    setSelectedRouterId(id);
    navigate("/");
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Routeurs MikroTik</h1>
          <p className="text-sm text-gray-500">Sélectionnez un routeur pour commencer</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isManager && (
            <Button variant="outline" className="gap-2" title="Identifiants admin" onClick={() => setShowCredentials(true)}>
              <KeyRound className="h-4 w-4" />
              <span className="hidden sm:inline">Identifiants admin</span>
            </Button>
          )}
          {!isManager && (
            <Button onClick={openCreate} className="gap-2" title="Ajouter un routeur">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Ajouter un routeur</span>
            </Button>
          )}
        </div>
      </div>

      {role === "admin" && !isSuperAdmin && adminMe && (() => {
        const used = adminMe.routerCount;
        const limit = adminMe.routerLimit;
        const remaining = Math.max(0, limit - used);
        const isFull = used >= limit;
        const isWarn = remaining <= 1;
        if (!isFull && !isWarn) return null;
        return (
          <Card className={`mb-4 border ${isFull ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
            <CardContent className="py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-2 min-w-0">
                <AlertTriangle className={`h-5 w-5 flex-shrink-0 ${isFull ? "text-red-500" : "text-amber-500"}`} />
                <div className="text-sm">
                  <div className={`font-medium ${isFull ? "text-red-900" : "text-amber-900"}`}>
                    {isFull
                      ? `Quota atteint : ${used}/${limit} routeurs`
                      : `Bientôt à la limite : ${used}/${limit} routeurs`}
                  </div>
                  <div className={`text-xs ${isFull ? "text-red-700" : "text-amber-700"}`}>
                    Crédits disponibles : {adminMe.credits}. Un pack +5 routeurs coûte 50 crédits.
                  </div>
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => buyRoutersM.mutate()}
                disabled={buyRoutersM.isPending || adminMe.credits < 50}
                className="gap-1"
              >
                <Plus className="h-4 w-4" />
                Acheter +5 routeurs (50 crédits)
              </Button>
            </CardContent>
          </Card>
        );
      })()}

      {isLoading ? (
        <div className="text-gray-400 text-sm">Chargement...</div>
      ) : routers.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <WifiOff className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">Aucun routeur configuré</p>
            <p className="text-sm text-gray-400 mt-1">Ajoutez votre premier routeur MikroTik pour commencer</p>
            <Button onClick={openCreate} className="mt-4 gap-2">
              <Plus className="h-4 w-4" /> Ajouter un routeur
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {routers.map((r) => {
            const isSelected = r.id === selectedRouterId;
            return (
              <Card
                key={r.id}
                className={`${isSelected ? "ring-2 ring-blue-500" : ""} cursor-pointer`}
                onClick={() => handleSelect(r.id)}
              >
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className={`p-2 rounded-lg flex-shrink-0 ${isSelected ? "bg-blue-500" : "bg-blue-50"}`}>
                        <Wifi className={`h-5 w-5 ${isSelected ? "text-white" : "text-blue-500"}`} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold text-gray-900">{r.name}</span>
                          {(r as any).hotspotName && (
                            <span className="text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 font-mono truncate max-w-[100px]">{(r as any).hotspotName}</span>
                          )}
                          {isSelected && (
                            <Badge className="bg-blue-100 text-blue-700 border-blue-300 gap-1 flex-shrink-0">
                              <CheckCircle2 className="h-3 w-3" /> Actif
                            </Badge>
                          )}
                          <Badge
                            variant="outline"
                            className={`flex-shrink-0 ${r.isActive ? "text-green-600 border-green-200" : "text-gray-400"}`}
                          >
                            {r.isActive ? "Connecté" : "Inactif"}
                          </Badge>
                          {testResults[r.id] && (
                            <Badge
                              variant="outline"
                              className={`flex-shrink-0 ${testResults[r.id].success ? "text-green-600 border-green-200" : "text-red-500 border-red-200"}`}
                            >
                              {testResults[r.id].success ? "✓ En ligne" : "✗ Hors ligne"}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5 truncate">
                          {r.host}:{r.port} · {r.username}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1 flex-shrink-0 w-[68px] justify-end">
                      {!isSelected && (
                        <Button
                          size="icon"
                          className="h-8 w-8 bg-blue-600 hover:bg-blue-700 text-white"
                          onClick={(e) => { e.stopPropagation(); handleSelect(r.id); }}
                          title="Sélectionner"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        className="h-8 w-8 text-blue-600 text-xs font-medium p-0"
                        onClick={(e) => { e.stopPropagation(); void handleTest(r.id); }}
                        disabled={testMutation.isPending}
                      >
                        Ping
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-gray-400 hover:text-gray-700"
                        onClick={(e) => { e.stopPropagation(); openEdit(r); }}
                        title="Modifier"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-gray-400" onClick={(e) => e.stopPropagation()}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem className="py-1.5 text-sm" onClick={() => setProfileMergeRouterId(r.id)}>
                            <Layers className="h-3.5 w-3.5 mr-2" /> Profils en base
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="py-1.5 text-sm text-blue-600 focus:text-blue-600 focus:bg-blue-50"
                            onClick={() => handleForceSync(r.id)}
                            disabled={forceSyncingId === r.id}
                          >
                            <RefreshCw className={`h-3.5 w-3.5 mr-2 ${forceSyncingId === r.id ? "animate-spin" : ""}`} />
                            {forceSyncingId === r.id ? "Resync en cours…" : "Resync complet"}
                          </DropdownMenuItem>
                          {!isManager && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="py-1.5 text-sm text-red-600 focus:text-red-600 focus:bg-red-50"
                                onClick={() => handleDelete(r.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5 mr-2" /> Supprimer
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md w-full flex flex-col">
          <DialogHeader>
            <DialogTitle>{editRouter ? "Modifier le routeur" : "Ajouter un routeur"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-0">
            <div className="overflow-y-auto px-1" style={{ maxHeight: "calc(90vh - 180px)" }}>
              <div className="form-shell space-y-4">
              <div>
                <Label>Nom</Label>
                <Input
                  className="mt-1"
                  placeholder="Mon routeur principal"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label>Nom du wifi</Label>
                <Input
                  className="mt-1"
                  placeholder="ex : HotspotVille"
                  value={form.hotspotName}
                  onChange={(e) => setForm({ ...form, hotspotName: e.target.value })}
                />
                <p className="text-xs text-gray-400 mt-0.5">Affiché comme titre dans les impressions de rapports (facultatif)</p>
              </div>
              <div>
                <Label>Contact</Label>
                <Input
                  className="mt-1"
                  placeholder="Tel : +243 XX XXX XXXX"
                  value={form.contact}
                  onChange={(e) => setForm({ ...form, contact: e.target.value })}
                />
                <p className="text-xs text-gray-400 mt-0.5">Affiché en bas de chaque ticket imprimé (facultatif)</p>
              </div>
              <div>
                <Label>Adresse (hôte:port)</Label>
                <Input
                  className="mt-1 font-mono"
                  placeholder="192.168.1.1:8728 ou mon.domaine.com:23728"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  required
                />
                <p className="text-xs text-gray-400 mt-0.5">Port API RouterOS — par défaut 8728 (ou votre port NAT)</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>Utilisateur</Label>
                  <Input
                    className="mt-1"
                    placeholder="admin"
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <Label>Mot de passe</Label>
                  <Input
                    className="mt-1"
                    type="password"
                    placeholder={editRouter ? "(inchangé)" : ""}
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    required={!editRouter}
                  />
                </div>
              </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-4 mt-2 border-t">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                Annuler
              </Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {editRouter ? "Mettre à jour" : "Ajouter"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <CredentialsDialog open={showCredentials} onClose={() => setShowCredentials(false)} />

      {profileMergeRouterId !== null && (
        <ProfileMergeDialog
          routerId={profileMergeRouterId}
          onClose={() => setProfileMergeRouterId(null)}
        />
      )}
    </div>
  );
}
