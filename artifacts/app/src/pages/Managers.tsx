import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserCog, Plus, Pencil, Trash2, Check, X, MoreHorizontal, KeyRound, Router as RouterIcon, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { PersonForm, type PersonFormData } from "@/pages/Vendors";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Manager = {
  id: number;
  name: string;
  username: string;
  isActive: boolean;
  createdAt: string;
  routerId: number | null;
};

type RouterInfo = { id: number; name: string };

export default function Managers() {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createRouterId, setCreateRouterId] = useState<number | null>(null);
  const [editManager, setEditManager] = useState<Manager | null>(null);
  const [editError, setEditError] = useState("");
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const { data: managers = [], isLoading } = useQuery<Manager[]>({
    queryKey: ["managers"],
    queryFn: async ({ signal }) => {
      const r = await fetch(`${BASE}/api/managers`, { headers, signal });
      if (!r.ok) throw new Error("Erreur chargement");
      return r.json();
    },
  });

  const { data: routers = [] } = useQuery<RouterInfo[]>({
    queryKey: ["routers-list"],
    queryFn: async ({ signal }) => {
      const r = await fetch(`${BASE}/api/routers`, { signal });
      if (!r.ok) throw new Error("Erreur chargement routeurs");
      return r.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (d: { name: string; username: string; password: string; routerId: number | null }) => {
      const r = await fetch(`${BASE}/api/managers`, { method: "POST", headers, body: JSON.stringify(d) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Erreur"); }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["managers"] });
      setCreateOpen(false);
      setCreateRouterId(null);
      toast({ title: "Gérant créé" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...d }: { id: number; name: string; username: string; password: string }) => {
      const r = await fetch(`${BASE}/api/managers/${id}`, { method: "PUT", headers, body: JSON.stringify(d) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Erreur"); }
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["managers"] }); setEditManager(null); toast({ title: "Gérant mis à jour" }); },
  });

  const assignRouterMutation = useMutation({
    mutationFn: async ({ id, routerId }: { id: number; routerId: number | null }) => {
      const r = await fetch(`${BASE}/api/managers/${id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ routerId }),
      });
      if (!r.ok) throw new Error("Erreur");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["managers"] });
      toast({ title: "Routeur assigné" });
    },
    onError: () => toast({ title: "Erreur", description: "Impossible d'assigner le routeur", variant: "destructive" }),
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
  });

  const handleDeleteManager = async () => {
    if (deleteId === null || deleteMutation.isPending) return;
    const id = deleteId;
    try {
      await deleteMutation.mutateAsync(id);
      qc.setQueryData<Manager[]>(["managers"], (prev) =>
        Array.isArray(prev) ? prev.filter((m) => m.id !== id) : prev,
      );
      qc.invalidateQueries({ queryKey: ["managers"] });
      setDeleteId(null);
      toast({ title: "Gérant supprimé" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur suppression";
      toast({ title: "Erreur", description: msg, variant: "destructive" });
    }
  };

  const handleCreate = async (data: PersonFormData) => {
    setCreateError("");
    try {
      await createMutation.mutateAsync({ name: data.name, username: data.username, password: data.password, routerId: createRouterId });
    } catch (err: any) {
      setCreateError(err?.message ?? "Une erreur est survenue");
    }
  };

  const handleEdit = async (data: PersonFormData) => {
    if (!editManager) return;
    setEditError("");
    try {
      await updateMutation.mutateAsync({ id: editManager.id, name: data.name, username: data.username, password: data.password });
    } catch (err: any) {
      setEditError(err?.message ?? "Une erreur est survenue");
    }
  };

  const getRouterName = (routerId: number | null) => {
    if (!routerId) return null;
    return routers.find((r) => r.id === routerId)?.name ?? `Routeur #${routerId}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <UserCog className="h-6 w-6" /> Gérants de zone
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Comptes avec accès complet sauf création/suppression de ressources
          </p>
        </div>
        <Button onClick={() => { setCreateError(""); setCreateRouterId(null); setCreateOpen(true); }} className="gap-2" title="Ajouter un gérant">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Ajouter un gérant</span>
        </Button>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="py-6 space-y-3">
            <Skeleton className="h-5 w-44 mx-auto" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
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
                    <div className="flex items-center gap-1 text-xs text-blue-500 mt-0.5">
                      <KeyRound className="h-3 w-3 flex-shrink-0" />
                      {m.username}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Badge variant={m.isActive ? "default" : "secondary"}>
                      {m.isActive ? "Actif" : "Inactif"}
                    </Badge>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-400">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem className="py-1.5 text-sm" onClick={() => { setEditError(""); setEditManager(m); }}>
                          <Pencil className="h-3.5 w-3.5 mr-2" /> Modifier
                        </DropdownMenuItem>
                        <DropdownMenuItem className="py-1.5 text-sm" onClick={() => toggleMutation.mutate({ id: m.id, isActive: !m.isActive })}>
                          {m.isActive
                            ? <><X className="h-3.5 w-3.5 mr-2" /> Désactiver</>
                            : <><Check className="h-3.5 w-3.5 mr-2" /> Activer</>}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="py-1.5 text-sm text-red-600 focus:text-red-600 focus:bg-red-50"
                          onClick={() => setDeleteId(m.id)}
                          disabled={deleteMutation.isPending && deleteId === m.id}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-2" /> Supprimer
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </CardHeader>

              {/* Router assignment section */}
              <CardContent className="pt-0 pb-3">
                <div className="border-t border-gray-100 pt-2.5">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <RouterIcon className="h-3 w-3 text-gray-400" />
                    <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Routeur assigné</span>
                  </div>
                  <Select
                    value={m.routerId ? String(m.routerId) : "none"}
                    onValueChange={(v) => {
                      const newRouterId = v === "none" ? null : parseInt(v, 10);
                      assignRouterMutation.mutate({ id: m.id, routerId: newRouterId });
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs border-dashed">
                      <SelectValue>
                        {m.routerId
                          ? <span className="flex items-center gap-1.5"><span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />{getRouterName(m.routerId)}</span>
                          : <span className="text-gray-400">Aucun routeur — sélection libre</span>
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none" className="text-xs text-gray-500">
                        Aucun routeur — sélection libre
                      </SelectItem>
                      {routers.map((r) => (
                        <SelectItem key={r.id} value={String(r.id)} className="text-xs">
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {m.routerId && (
                    <p className="text-[10px] text-amber-600 mt-1 flex items-center gap-1">
                      🔒 Le gérant sera verrouillé sur ce routeur
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) { setCreateOpen(false); setCreateError(""); setCreateRouterId(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Ajouter un gérant de zone</DialogTitle></DialogHeader>

          {/* Router assignment in create form */}
          <div className="px-0 pb-2">
            <Label className="text-sm text-gray-700">Routeur assigné (optionnel)</Label>
            <Select
              value={createRouterId ? String(createRouterId) : "none"}
              onValueChange={(v) => setCreateRouterId(v === "none" ? null : parseInt(v, 10))}
            >
              <SelectTrigger className="h-9 text-sm mt-1">
                <SelectValue>
                  {createRouterId
                    ? routers.find((r) => r.id === createRouterId)?.name ?? `Routeur #${createRouterId}`
                    : <span className="text-gray-400">Aucun routeur — sélection libre</span>
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="text-sm text-gray-500">Aucun routeur — sélection libre</SelectItem>
                {routers.map((r) => (
                  <SelectItem key={r.id} value={String(r.id)} className="text-sm">{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {createRouterId && (
              <p className="text-[11px] text-amber-600 mt-1">🔒 Le gérant sera verrouillé sur ce routeur</p>
            )}
          </div>

          <PersonForm
            onSubmit={handleCreate}
            onCancel={() => { setCreateOpen(false); setCreateError(""); setCreateRouterId(null); }}
            loading={createMutation.isPending}
            serverError={createError}
            forManager
            nameLabel="Nom complet"
            portalSectionLabel="Accès gérant"
          />
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editManager} onOpenChange={(o) => { if (!o) { setEditManager(null); setEditError(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Modifier le gérant</DialogTitle></DialogHeader>
          {editManager && (
            <PersonForm
              initial={{ name: editManager.name, username: editManager.username }}
              onSubmit={handleEdit}
              onCancel={() => { setEditManager(null); setEditError(""); }}
              loading={updateMutation.isPending}
              isEdit
              serverError={editError}
              forManager
              nameLabel="Nom complet"
              portalSectionLabel="Accès gérant"
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && !deleteMutation.isPending && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce gérant ?</AlertDialogTitle>
            <AlertDialogDescription>Cette action est irréversible.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => void handleDeleteManager()}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending
                ? <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" />Suppression...</span>
                : "Supprimer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
