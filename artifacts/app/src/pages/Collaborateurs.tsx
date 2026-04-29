import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Users, Plus, Pencil, Trash2, Check, X, MoreHorizontal, KeyRound, Router as RouterIcon, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { PersonForm, type PersonFormData } from "@/pages/Vendors";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Collaborateur = {
  id: number;
  name: string;
  username: string;
  isActive: boolean;
  createdAt: string;
  routerIds: number[];
};

type RouterInfo = { id: number; name: string };

function RouterMultiSelect({
  routers,
  selected,
  onChange,
}: {
  routers: RouterInfo[];
  selected: number[];
  onChange: (ids: number[]) => void;
}) {
  const toggle = (id: number) => {
    if (selected.includes(id)) {
      onChange(selected.filter((r) => r !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  return (
    <div className="space-y-2">
      {routers.length === 0 ? (
        <p className="text-xs text-gray-400 italic">Aucun routeur disponible</p>
      ) : (
        routers.map((r) => (
          <div
            key={r.id}
            className={cn(
              "flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-colors",
              selected.includes(r.id)
                ? "border-purple-400/50 bg-purple-500/10"
                : "border-gray-200 bg-white hover:border-gray-300",
            )}
            onClick={() => toggle(r.id)}
          >
            <Checkbox
              id={`router-${r.id}`}
              checked={selected.includes(r.id)}
              onCheckedChange={() => toggle(r.id)}
              className="pointer-events-none"
            />
            <label htmlFor={`router-${r.id}`} className="text-sm text-gray-700 cursor-pointer flex-1">
              {r.name}
            </label>
            {selected.includes(r.id) && (
              <ShieldCheck className="h-3.5 w-3.5 text-purple-500 flex-shrink-0" />
            )}
          </div>
        ))
      )}
    </div>
  );
}

export default function Collaborateurs() {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createRouterIds, setCreateRouterIds] = useState<number[]>([]);

  const [editCollab, setEditCollab] = useState<Collaborateur | null>(null);
  const [editError, setEditError] = useState("");
  const [editRouterIds, setEditRouterIds] = useState<number[]>([]);

  const [deleteId, setDeleteId] = useState<number | null>(null);

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const { data: collabs = [], isLoading } = useQuery<Collaborateur[]>({
    queryKey: ["collaborateurs"],
    queryFn: async ({ signal }) => {
      const r = await fetch(`${BASE}/api/collaborateurs`, { headers, signal });
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
    mutationFn: async (d: { name: string; username: string; password: string; routerIds: number[] }) => {
      const r = await fetch(`${BASE}/api/collaborateurs`, { method: "POST", headers, body: JSON.stringify(d) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Erreur"); }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collaborateurs"] });
      setCreateOpen(false);
      setCreateRouterIds([]);
      toast({ title: "Collaborateur créé" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...d }: { id: number; name?: string; username?: string; password?: string; routerIds?: number[]; isActive?: boolean }) => {
      const r = await fetch(`${BASE}/api/collaborateurs/${id}`, { method: "PUT", headers, body: JSON.stringify(d) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Erreur"); }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collaborateurs"] });
      setEditCollab(null);
      toast({ title: "Collaborateur mis à jour" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      const r = await fetch(`${BASE}/api/collaborateurs/${id}`, { method: "PUT", headers, body: JSON.stringify({ isActive }) });
      if (!r.ok) throw new Error("Erreur");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["collaborateurs"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`${BASE}/api/collaborateurs/${id}`, { method: "DELETE", headers });
      if (!r.ok) throw new Error("Erreur suppression");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collaborateurs"] });
      setDeleteId(null);
      toast({ title: "Collaborateur supprimé" });
    },
    onError: (e: Error) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const handleCreate = async (data: PersonFormData) => {
    setCreateError("");
    if (createRouterIds.length === 0) {
      setCreateError("Veuillez assigner au moins un routeur");
      return;
    }
    try {
      await createMutation.mutateAsync({ name: data.name, username: data.username, password: data.password, routerIds: createRouterIds });
    } catch (err: any) {
      setCreateError(err?.message ?? "Une erreur est survenue");
    }
  };

  const handleEdit = async (data: PersonFormData) => {
    if (!editCollab) return;
    setEditError("");
    if (editRouterIds.length === 0) {
      setEditError("Veuillez assigner au moins un routeur");
      return;
    }
    try {
      await updateMutation.mutateAsync({ id: editCollab.id, name: data.name, username: data.username, password: data.password, routerIds: editRouterIds });
    } catch (err: any) {
      setEditError(err?.message ?? "Une erreur est survenue");
    }
  };

  const openEdit = (c: Collaborateur) => {
    setEditError("");
    setEditRouterIds(c.routerIds ?? []);
    setEditCollab(c);
  };

  const getRouterNames = (routerIds: number[]) =>
    routerIds.map((id) => routers.find((r) => r.id === id)?.name ?? `Routeur #${id}`);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Users className="h-6 w-6" /> Collaborateurs
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Accès admin complet sur les routeurs assignés uniquement
          </p>
        </div>
        <Button onClick={() => { setCreateError(""); setCreateRouterIds([]); setCreateOpen(true); }} className="gap-2">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Ajouter un collaborateur</span>
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
      ) : collabs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-gray-400">
            <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>Aucun collaborateur créé</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {collabs.map((c) => (
            <Card key={c.id} className="relative">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base truncate">{c.name}</CardTitle>
                    <div className="flex items-center gap-1 text-xs text-purple-500 mt-0.5">
                      <KeyRound className="h-3 w-3 flex-shrink-0" />
                      {c.username}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Badge variant={c.isActive ? "default" : "secondary"}>
                      {c.isActive ? "Actif" : "Inactif"}
                    </Badge>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-400">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem className="py-1.5 text-sm" onClick={() => openEdit(c)}>
                          <Pencil className="h-3.5 w-3.5 mr-2" /> Modifier
                        </DropdownMenuItem>
                        <DropdownMenuItem className="py-1.5 text-sm" onClick={() => toggleMutation.mutate({ id: c.id, isActive: !c.isActive })}>
                          {c.isActive
                            ? <><X className="h-3.5 w-3.5 mr-2" /> Désactiver</>
                            : <><Check className="h-3.5 w-3.5 mr-2" /> Activer</>}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="py-1.5 text-sm text-red-600 focus:text-red-600 focus:bg-red-50"
                          onClick={() => setDeleteId(c.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-2" /> Supprimer
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="pt-0 pb-3">
                <div className="border-t border-gray-100 pt-2.5">
                  <div className="flex items-center gap-1.5 mb-2">
                    <RouterIcon className="h-3 w-3 text-gray-400" />
                    <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Routeurs assignés</span>
                    <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-600">
                      {c.routerIds.length}
                    </span>
                  </div>
                  {c.routerIds.length === 0 ? (
                    <p className="text-xs text-gray-400 italic">Aucun routeur assigné</p>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {getRouterNames(c.routerIds).map((name, i) => (
                        <span key={i} className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200">
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-purple-400 flex-shrink-0" />
                          {name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Create dialog ── */}
      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) { setCreateOpen(false); setCreateError(""); setCreateRouterIds([]); } }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Ajouter un collaborateur</DialogTitle></DialogHeader>

          <div className="pb-2">
            <Label className="text-sm text-gray-700 mb-2 block">
              Routeurs assignés <span className="text-red-500">*</span>
            </Label>
            <RouterMultiSelect
              routers={routers}
              selected={createRouterIds}
              onChange={setCreateRouterIds}
            />
            {createRouterIds.length > 0 && (
              <p className="text-[11px] text-purple-600 mt-1.5 flex items-center gap-1">
                🔒 Le collaborateur aura accès à {createRouterIds.length} routeur{createRouterIds.length > 1 ? "s" : ""}
              </p>
            )}
          </div>

          <PersonForm
            onSubmit={handleCreate}
            onCancel={() => { setCreateOpen(false); setCreateError(""); setCreateRouterIds([]); }}
            loading={createMutation.isPending}
            serverError={createError}
            forManager
            nameLabel="Nom complet"
            portalSectionLabel="Accès collaborateur"
          />
        </DialogContent>
      </Dialog>

      {/* ── Edit dialog ── */}
      <Dialog open={!!editCollab} onOpenChange={(o) => { if (!o) { setEditCollab(null); setEditError(""); } }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Modifier le collaborateur</DialogTitle></DialogHeader>
          {editCollab && (
            <>
              <div className="pb-2">
                <Label className="text-sm text-gray-700 mb-2 block">
                  Routeurs assignés <span className="text-red-500">*</span>
                </Label>
                <RouterMultiSelect
                  routers={routers}
                  selected={editRouterIds}
                  onChange={setEditRouterIds}
                />
                {editRouterIds.length > 0 && (
                  <p className="text-[11px] text-purple-600 mt-1.5 flex items-center gap-1">
                    🔒 Le collaborateur aura accès à {editRouterIds.length} routeur{editRouterIds.length > 1 ? "s" : ""}
                  </p>
                )}
              </div>

              <PersonForm
                initial={{ name: editCollab.name, username: editCollab.username }}
                onSubmit={handleEdit}
                onCancel={() => { setEditCollab(null); setEditError(""); }}
                loading={updateMutation.isPending}
                isEdit
                serverError={editError}
                forManager
                nameLabel="Nom complet"
                portalSectionLabel="Accès collaborateur"
              />
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce collaborateur ?</AlertDialogTitle>
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
