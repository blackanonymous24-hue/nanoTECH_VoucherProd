import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useRefetchOnEmpty } from "@/hooks/use-refetch-on-empty";
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
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Trash2, Wifi, WifiOff, Edit, KeyRound, CheckCircle2, AlertTriangle, Coins, Activity, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useRouterContext } from "@/contexts/RouterContext";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type RouterFormData = {
  name: string;
  hotspotName: string;
  contact: string;
  currency: string;
  address: string;
  username: string;
  password: string;
  autoDeleteSalesScripts: boolean;
};

const emptyForm: RouterFormData = {
  name: "",
  hotspotName: "",
  contact: "",
  currency: "FCFA",
  address: "",
  username: "admin",
  password: "",
  autoDeleteSalesScripts: false,
};

const MAX_CURRENCY_LEN = 24;

/** Devise affichée en majuscules (saisie, collage, édition). */
function normalizeRouterCurrency(raw: string): string {
  const v = raw.trim().toUpperCase().slice(0, MAX_CURRENCY_LEN);
  return v || "FCFA";
}

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
  const [form, setForm] = useState({ login: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    void fetch(`${BASE}/api/admin/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) setForm({ login: data.login ?? "", password: data.passwordPlain ?? "" });
      })
      .catch(() => {});
  }, [open, token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!form.login.trim() && !form.password) {
      setError("Renseignez au moins un champ à modifier");
      return;
    }
    if (form.login.trim() && form.login.trim().length < 3) {
      setError("Login trop court (min 3 caractères)");
      return;
    }
    if (form.password && form.password.length < 4) {
      setError("Mot de passe trop court (min 4 caractères)");
      return;
    }
    setLoading(true);
    try {
      const payload: { login?: string; password?: string } = {};
      if (form.login.trim()) payload.login = form.login.trim();
      if (form.password) payload.password = form.password;
      const res = await fetch(`${BASE}/api/admin/credentials`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Erreur");
        return;
      }
      toast({ title: "Identifiants mis à jour" });
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
          <DialogTitle>Mes identifiants admin</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div>
            <Label>Login</Label>
            <Input
              className="mt-1"
              placeholder="Identifiant de connexion"
              value={form.login}
              onChange={(e) => setForm({ ...form, login: e.target.value })}
            />
          </div>
          <div>
            <Label>Mot de passe</Label>
            <PasswordInput
              className="mt-1"
              placeholder="••••••••"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
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

export default function Routers() {
  const { data: routers = [], isLoading, isError, error, refetch, isFetching } = useListRouters();
  useRefetchOnEmpty(routers, isLoading, () => void refetch(), (d) => !d || d.length === 0);
  const createMutation = useCreateRouter();
  const deleteMutation = useDeleteRouter();
  const updateMutation = useUpdateRouter();
  const testMutation = useTestRouterConnection();
  const [pingingIds, setPingingIds] = useState<Set<number>>(new Set());
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
  const adminCredits = Math.max(0, adminMe?.credits ?? 0);
  const adminUsedRouters = adminMe?.routerCount ?? routers.length;
  const adminRouterLimit = adminMe?.routerLimit ?? 5;
  const adminRemainingRouters = Math.max(0, adminRouterLimit - adminUsedRouters);
  const [showForm, setShowForm] = useState(false);
  const [showCredentials, setShowCredentials] = useState(false);
  const [editRouter, setEditRouter] = useState<RouterType | null>(null);
  const [form, setForm] = useState<RouterFormData>(emptyForm);
  const [testResults, setTestResults] = useState<Record<number, { success: boolean; message: string }>>({});
  const [deletingRouterId, setDeletingRouterId] = useState<number | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListRoutersQueryKey() });

  const openCreate = () => {
    setForm(emptyForm);
    setEditRouter(null);
    setShowForm(true);
  };

  const openEdit = (r: RouterType) => {
    setForm({
      name: r.name,
      hotspotName: (r as { hotspotName?: string }).hotspotName ?? "",
      contact: (r as { contact?: string }).contact ?? "",
      currency: normalizeRouterCurrency(r.currency ?? ""),
      address: `${r.host}:${r.port}`,
      username: r.username,
      password: (r as { password?: string }).password ?? "",
      autoDeleteSalesScripts: (r as { autoDeleteSalesScripts?: boolean }).autoDeleteSalesScripts ?? false,
    });
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
    if (!editRouter && !form.password) {
      toast({ title: "Mot de passe requis", description: "Veuillez saisir un mot de passe pour le routeur.", variant: "destructive" });
      return;
    }
    const basePayload = {
      name: form.name,
      hotspotName: form.hotspotName || undefined,
      contact: form.contact || undefined,
      currency: normalizeRouterCurrency(form.currency),
      host,
      port,
      username: form.username,
      autoDeleteSalesScripts: form.autoDeleteSalesScripts,
    };
    if (editRouter) {
      // password vide = non modifié → le serveur conserve l'ancien
      await updateMutation.mutateAsync({ id: editRouter.id, data: { ...basePayload, password: form.password } });
      toast({ title: "Routeur mis à jour" });
    } else {
      await createMutation.mutateAsync({ data: { ...basePayload, password: form.password } });
      toast({ title: "Routeur ajouté" });
    }
    setShowForm(false);
    invalidate();
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Supprimer ce routeur et tous ses vouchers ?")) return;
    if (deletingRouterId !== null) return;
    setDeletingRouterId(id);
    try {
      await deleteMutation.mutateAsync({ id });
      queryClient.setQueryData<RouterType[]>(getListRoutersQueryKey(), (prev) =>
        Array.isArray(prev) ? prev.filter((r) => r.id !== id) : prev,
      );
      toast({ title: "Routeur supprimé" });
      invalidate();
    } finally {
      setDeletingRouterId(null);
    }
  };

  const handleTest = async (id: number) => {
    setPingingIds((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`${BASE}/api/routers/${id}/ping?force=1`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json() as { success: boolean };
      setTestResults((prev) => ({ ...prev, [id]: { success: data.success, message: data.success ? "En ligne" : "Hors ligne" } }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur de connexion";
      setTestResults((prev) => ({ ...prev, [id]: { success: false, message } }));
    } finally {
      setPingingIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
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

      {role === "admin" && !isSuperAdmin && (
        <Card className="mb-4 border border-blue-200 bg-blue-50">
          <CardContent className="py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Badge variant="outline" className="border-blue-300 text-blue-700 bg-white font-semibold">
                Routeurs: {adminUsedRouters}/{adminRouterLimit}
              </Badge>
              <Badge variant="outline" className="border-emerald-300 text-emerald-700 bg-white font-semibold gap-1">
                <Coins className="h-3.5 w-3.5" />
                Crédits: {adminCredits}
              </Badge>
              <span className="text-xs text-blue-700">
                Restants: {adminRemainingRouters}
              </span>
            </div>
            <span className="text-xs text-blue-700">
              Débit auto: 10 crédits quand la limite est atteinte et qu&apos;un routeur est ajouté.
            </span>
          </CardContent>
        </Card>
      )}

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
                    Crédits disponibles : {adminCredits}. Si vous ajoutez un routeur au-delà de la limite, 10 crédits sont débités automatiquement.
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : isError ? (
        <Card className="border-red-200 bg-red-50/80">
          <CardContent className="py-10 text-center space-y-3">
            <AlertTriangle className="h-10 w-10 text-red-500 mx-auto" />
            <p className="text-red-900 font-medium">Impossible de charger la liste des routeurs</p>
            <p className="text-sm text-red-800/90 max-w-md mx-auto">
              Vos routeurs sont toujours en base ; le serveur a peut‑être besoin d&apos;un redémarrage après mise à jour (schéma PostgreSQL). Réessayez ou contactez l&apos;administrateur si le problème continue.
            </p>
            {error instanceof Error && error.message && (
              <p className="text-xs text-red-700 font-mono break-all px-2">{error.message}</p>
            )}
            <Button variant="outline" onClick={() => void refetch()} disabled={isFetching} className="gap-2">
              {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Réessayer
            </Button>
          </CardContent>
        </Card>
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
        <div className="space-y-2">
          {routers.map((r) => {
            const isSelected = r.id === selectedRouterId;
            return (
              <Card
                key={r.id}
                className={`${isSelected ? "ring-2 ring-blue-500" : ""}`}
              >
                <CardContent className="py-3 px-3 sm:py-3 sm:px-4">
                  <div className="flex items-center justify-between gap-2">
                    <div
                      className="flex items-center gap-2.5 min-w-0 w-3/4 max-w-[75%] cursor-pointer"
                      onClick={() => handleSelect(r.id)}
                      title="Sélectionner ce routeur"
                    >
                      <div className={`p-1.5 rounded-md flex-shrink-0 ${isSelected ? "bg-blue-500" : "bg-blue-50"}`}>
                        <Wifi className={`h-4 w-4 ${isSelected ? "text-white" : "text-blue-500"}`} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="font-semibold text-sm text-gray-900">{r.name}</span>
                          {isSelected && (
                            <Badge className="h-5 px-1.5 bg-blue-100 text-blue-700 border-blue-300 gap-1 flex-shrink-0">
                              <CheckCircle2 className="h-2.5 w-2.5" /> Actif
                            </Badge>
                          )}
                          {testResults[r.id] && (
                            <span
                              className={`inline-flex items-center rounded-full px-1.5 h-5 text-[10px] font-medium border ${
                                testResults[r.id].success
                                  ? "text-green-600 border-green-200 bg-green-50"
                                  : "text-red-500 border-red-200 bg-red-50"
                              }`}
                            >
                              {testResults[r.id].success ? "En ligne" : "Hors ligne"}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-gray-500 leading-tight truncate">
                          {r.host}:{r.port}
                        </p>
                      </div>
                    </div>
                    <div
                      className="flex items-center gap-1 flex-shrink-0 justify-end"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="relative">
                        {pingingIds.has(r.id) && (
                          <span className="absolute inset-0 rounded-full animate-ping bg-blue-300 opacity-60 pointer-events-none" />
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 rounded-full text-blue-600 hover:text-blue-700 hover:bg-blue-50 border border-blue-100 relative"
                          onClick={(e) => { e.stopPropagation(); void handleTest(r.id); }}
                          disabled={pingingIds.has(r.id)}
                          title="Ping"
                        >
                          {pingingIds.has(r.id)
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Activity className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 rounded-full text-slate-500 hover:text-slate-700 hover:bg-slate-100 border border-slate-200"
                        onClick={(e) => { e.stopPropagation(); openEdit(r); }}
                        title="Modifier"
                      >
                        <Edit className="h-3.5 w-3.5" />
                      </Button>
                      {!isManager && (
                        <div className="ml-4 pl-3 border-l border-gray-200">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 rounded-full text-red-600 hover:text-red-700 hover:bg-red-50 border border-red-100"
                            onClick={(e) => { e.stopPropagation(); void handleDelete(r.id); }}
                            disabled={deletingRouterId !== null}
                            title="Supprimer"
                          >
                            {deletingRouterId === r.id
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Trash2 className="h-3.5 w-3.5" />}
                          </Button>
                        </div>
                      )}
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
                <Label>Devise</Label>
                <Input
                  className="mt-1 h-9 text-sm font-mono uppercase"
                  placeholder="ex. FCFA, EUR, USD"
                  autoCapitalize="characters"
                  spellCheck={false}
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: normalizeRouterCurrency(e.target.value) })}
                />
                <p className="text-xs text-gray-400 mt-0.5">Saisie en majuscules automatique (tickets, rapports), max. 24 caractères</p>
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
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
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
                  <Label>
                    Mot de passe{!editRouter && <span className="text-red-500"> *</span>}
                  </Label>
                  <PasswordInput
                    className="mt-1"
                    placeholder={editRouter ? "••••••••" : ""}
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    required={!editRouter}
                  />
                </div>
              </div>
              <label className={`flex items-start gap-2 rounded-md border px-3 py-2 cursor-pointer ${form.autoDeleteSalesScripts ? "border-red-300 bg-red-50" : "border-gray-200 bg-gray-50"}`}>
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-red-600"
                  checked={form.autoDeleteSalesScripts}
                  onChange={(e) => setForm({ ...form, autoDeleteSalesScripts: e.target.checked })}
                />
                <span className="text-sm">
                  <span className={`font-medium ${form.autoDeleteSalesScripts ? "text-red-700" : "text-gray-700"}`}>
                    Suppression auto des scripts de ventes MikroTik après sauvegarde locale
                  </span>
                  <span className="block text-xs text-gray-500 mt-1">
                    La suppression n'est exécutée que si <strong>100 % des données sont confirmées en base locale</strong>. En cas de doute, la suppression est annulée automatiquement.
                  </span>
                  {form.autoDeleteSalesScripts && (
                    <span className="block text-xs text-red-600 font-medium mt-1">
                      ⚠ Option active — les scripts supprimés de MikroTik sont irrecupérables. Vérifiez que la sauvegarde locale fonctionne correctement avant d'activer cette option.
                    </span>
                  )}
                </span>
              </label>
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

    </div>
  );
}
