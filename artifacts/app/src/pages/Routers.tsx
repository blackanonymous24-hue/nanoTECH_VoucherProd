import { useState } from "react";
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
import { useQueryClient } from "@tanstack/react-query";
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
import { Plus, Trash2, Wifi, WifiOff, Edit, TestTube, KeyRound, CheckCircle2, MoreHorizontal } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useRouterContext } from "@/contexts/RouterContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

export default function Routers() {
  const { data: routers = [], isLoading } = useListRouters();
  const createMutation = useCreateRouter();
  const deleteMutation = useDeleteRouter();
  const updateMutation = useUpdateRouter();
  const testMutation = useTestRouterConnection();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { setSelectedRouterId, selectedRouterId } = useRouterContext();
  const { role } = useAuth();
  const isManager = role === "manager";
  const [, navigate] = useLocation();

  const [showForm, setShowForm] = useState(false);
  const [showCredentials, setShowCredentials] = useState(false);
  const [editRouter, setEditRouter] = useState<RouterType | null>(null);
  const [form, setForm] = useState<RouterFormData>(emptyForm);
  const [testResults, setTestResults] = useState<Record<number, { success: boolean; message: string }>>({});

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

  const handleSelect = (id: number) => {
    setSelectedRouterId(id);
    navigate("/");
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Routeurs MikroTik</h1>
          <p className="text-sm text-gray-500">Sélectionnez un routeur pour commencer</p>
        </div>
        <div className="flex items-center gap-2">
          {!isManager && (
            <Button variant="outline" className="gap-2" onClick={() => setShowCredentials(true)}>
              <KeyRound className="h-4 w-4" /> Identifiants admin
            </Button>
          )}
          {!isManager && (
            <Button onClick={openCreate} className="gap-2">
              <Plus className="h-4 w-4" /> Ajouter un routeur
            </Button>
          )}
        </div>
      </div>

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
              <Card key={r.id} className={isSelected ? "ring-2 ring-blue-500" : ""}>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={`p-2 rounded-lg ${isSelected ? "bg-blue-500" : "bg-blue-50"}`}>
                        <Wifi className={`h-5 w-5 ${isSelected ? "text-white" : "text-blue-500"}`} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-900">{r.name}</span>
                          {(r as any).hotspotName && (
                            <span className="text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 font-mono">{(r as any).hotspotName}</span>
                          )}
                          {isSelected && (
                            <Badge className="bg-blue-100 text-blue-700 border-blue-300 gap-1">
                              <CheckCircle2 className="h-3 w-3" /> Actif
                            </Badge>
                          )}
                          <Badge
                            variant="outline"
                            className={r.isActive ? "text-green-600 border-green-200" : "text-gray-400"}
                          >
                            {r.isActive ? "Connecté" : "Inactif"}
                          </Badge>
                          {testResults[r.id] && (
                            <Badge
                              variant="outline"
                              className={testResults[r.id].success ? "text-green-600 border-green-200" : "text-red-500 border-red-200"}
                            >
                              {testResults[r.id].success ? "✓ En ligne" : "✗ Hors ligne"}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-gray-500 mt-0.5">
                          {r.host}:{r.port} · {r.username}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!isSelected && (
                        <Button
                          size="sm"
                          className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
                          onClick={() => handleSelect(r.id)}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> Sélectionner
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 text-blue-600"
                        onClick={() => handleTest(r.id)}
                        disabled={testMutation.isPending}
                      >
                        <TestTube className="h-3.5 w-3.5" /> Tester
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-8 w-8 text-gray-400">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem className="py-1.5 text-sm" onClick={() => openEdit(r)}>
                            <Edit className="h-3.5 w-3.5 mr-2" /> Modifier
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
            <div className="overflow-y-auto px-1 space-y-4" style={{ maxHeight: "calc(90vh - 180px)" }}>
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
              <div className="grid grid-cols-2 gap-3">
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
