import { useState } from "react";
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
import { Plus, Trash2, Wifi, WifiOff, Edit, TestTube } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type RouterFormData = {
  name: string;
  contact: string;
  address: string;
  username: string;
  password: string;
};

const emptyForm: RouterFormData = {
  name: "",
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

export default function Routers() {
  const { data: routers = [], isLoading } = useListRouters();
  const createMutation = useCreateRouter();
  const deleteMutation = useDeleteRouter();
  const updateMutation = useUpdateRouter();
  const testMutation = useTestRouterConnection();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [showForm, setShowForm] = useState(false);
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
    setForm({ name: r.name, contact: (r as any).contact ?? "", address: `${r.host}:${r.port}`, username: r.username, password: "" });
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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Routeurs MikroTik</h1>
          <p className="text-sm text-gray-500">Gérez vos connexions RouterOS</p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" /> Ajouter un routeur
        </Button>
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
          {routers.map((r) => (
            <Card key={r.id}>
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="p-2 bg-blue-50 rounded-lg">
                      <Wifi className="h-5 w-5 text-blue-500" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900">{r.name}</span>
                        <Badge
                          variant="outline"
                          className={r.isActive ? "text-green-600 border-green-200" : "text-gray-400"}
                        >
                          {r.isActive ? "Actif" : "Inactif"}
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
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 text-blue-600"
                      onClick={() => handleTest(r.id)}
                      disabled={testMutation.isPending}
                    >
                      <TestTube className="h-3.5 w-3.5" /> Tester
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>
                      <Edit className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-500 hover:text-red-600"
                      onClick={() => handleDelete(r.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editRouter ? "Modifier le routeur" : "Ajouter un routeur"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
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
            <div className="flex justify-end gap-2 pt-2">
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
    </div>
  );
}
