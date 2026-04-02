import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { UserCog, Plus, Pencil, Trash2, Check, X, MoreHorizontal } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Manager = { id: number; name: string; username: string; isActive: boolean; createdAt: string };
type FormData = { name: string; username: string; password: string };

function ManagerForm({
  initial, onSubmit, onCancel, loading, isEdit,
}: {
  initial?: Partial<Manager>;
  onSubmit: (d: FormData) => void;
  onCancel: () => void;
  loading: boolean;
  isEdit?: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState("");

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ name, username, password }); }} className="space-y-4">
      <div>
        <Label>Nom complet</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jean Dupont" required />
      </div>
      <div>
        <Label>Nom d'utilisateur</Label>
        <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="jean.dupont" required />
      </div>
      <div>
        <Label>{isEdit ? "Nouveau mot de passe (laisser vide = inchangé)" : "Mot de passe"}</Label>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          required={!isEdit}
          minLength={isEdit && !password ? undefined : 6}
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>Annuler</Button>
        <Button type="submit" disabled={loading}>
          {loading ? "Enregistrement..." : isEdit ? "Mettre à jour" : "Créer"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export default function Managers() {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [editManager, setEditManager] = useState<Manager | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const { data: managers = [], isLoading } = useQuery<Manager[]>({
    queryKey: ["managers"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/managers`, { headers });
      if (!r.ok) throw new Error("Erreur chargement");
      return r.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (d: FormData) => {
      const r = await fetch(`${BASE}/api/managers`, { method: "POST", headers, body: JSON.stringify(d) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Erreur"); }
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["managers"] }); setCreateOpen(false); toast({ title: "Gérant créé" }); },
    onError: (e: Error) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...d }: FormData & { id: number }) => {
      const r = await fetch(`${BASE}/api/managers/${id}`, { method: "PUT", headers, body: JSON.stringify(d) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Erreur"); }
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["managers"] }); setEditManager(null); toast({ title: "Gérant mis à jour" }); },
    onError: (e: Error) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      const r = await fetch(`${BASE}/api/managers/${id}`, { method: "PUT", headers, body: JSON.stringify({ isActive }) });
      if (!r.ok) throw new Error("Erreur");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["managers"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`${BASE}/api/managers/${id}`, { method: "DELETE", headers });
      if (!r.ok) throw new Error("Erreur suppression");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["managers"] }); setDeleteId(null); toast({ title: "Gérant supprimé" }); },
    onError: (e: Error) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <UserCog className="h-6 w-6" /> Gérants de zone
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Comptes avec accès complet sauf création/suppression de ressources
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Ajouter un gérant
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Chargement...</div>
      ) : managers.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-gray-400">
            <UserCog className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>Aucun gérant de zone créé</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {managers.map((m) => (
            <Card key={m.id} className="relative">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base truncate">{m.name}</CardTitle>
                    <p className="text-xs text-gray-500 mt-0.5">@{m.username}</p>
                  </div>
                  <Badge variant={m.isActive ? "default" : "secondary"} className="flex-shrink-0">
                    {m.isActive ? "Actif" : "Inactif"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0 pb-3 px-4 flex justify-end">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-400">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setEditManager(m)}>
                      <Pencil className="h-3.5 w-3.5 mr-2" /> Modifier
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => toggleMutation.mutate({ id: m.id, isActive: !m.isActive })}>
                      {m.isActive
                        ? <><X className="h-3.5 w-3.5 mr-2" /> Désactiver</>
                        : <><Check className="h-3.5 w-3.5 mr-2" /> Activer</>}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-red-600 focus:text-red-600 focus:bg-red-50"
                      onClick={() => setDeleteId(m.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-2" /> Supprimer
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Ajouter un gérant de zone</DialogTitle></DialogHeader>
          <ManagerForm
            onSubmit={(d) => createMutation.mutate(d)}
            onCancel={() => setCreateOpen(false)}
            loading={createMutation.isPending}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={!!editManager} onOpenChange={(o) => !o && setEditManager(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Modifier le gérant</DialogTitle></DialogHeader>
          {editManager && (
            <ManagerForm
              initial={editManager}
              onSubmit={(d) => updateMutation.mutate({ id: editManager.id, ...d })}
              onCancel={() => setEditManager(null)}
              loading={updateMutation.isPending}
              isEdit
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce gérant ?</AlertDialogTitle>
            <AlertDialogDescription>Cette action est irréversible.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteId !== null && deleteMutation.mutate(deleteId)}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
