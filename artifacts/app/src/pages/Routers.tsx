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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  host: string;
  port: string;
  username: string;
  password: string;
};

const emptyForm: RouterFormData = {
  name: "",
  host: "",
  port: "8728",
  username: "admin",
  password: "",
};

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
    setForm({ name: r.name, host: r.host, port: String(r.port), username: r.username, password: "" });
    setEditRouter(r);
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      name: form.name,
      host: form.host,
      port: parseInt(form.port, 10),
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
    const result = await testMutation.mutateAsync({ id });
    setTestResults((prev) => ({ ...prev, [id]: result }));
    toast({
      title: result.success ? "Connexion réussie" : "Connexion échouée",
      description: result.message,
      variant: result.success ? "default" : "destructive",
    });
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
                      onClick={() => handleTest(r.id)}
                      disabled={testMutation.isPending}
                      className="gap-1.5"
                    >
                      <TestTube className="h-3.5 w-3.5" />
                      Tester
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openEdit(r)} className="gap-1.5">
                      <Edit className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDelete(r.id)}
                      className="gap-1.5 text-red-500 hover:text-red-600 hover:border-red-300"
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
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Label>Hôte / IP</Label>
                <Input
                  className="mt-1"
                  placeholder="192.168.1.1"
                  value={form.host}
                  onChange={(e) => setForm({ ...form, host: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label>Port API</Label>
                <Input
                  className="mt-1"
                  placeholder="8728"
                  value={form.port}
                  onChange={(e) => setForm({ ...form, port: e.target.value })}
                  required
                />
              </div>
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
