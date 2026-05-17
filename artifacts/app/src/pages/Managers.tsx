import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRefetchOnEmpty } from "@/hooks/use-refetch-on-empty";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserCog, Plus, Pencil, Trash2, Check, X, MoreHorizontal, KeyRound, Router as RouterIcon, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { PersonForm, type PersonFormData } from "@/pages/Vendors";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Manager = {
  id: number;
  name: string;
  username: string;
  passwordPlain?: string | null;
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
                ? "border-amber-400/50 bg-amber-500/10"
                : "border-gray-200 bg-white hover:border-gray-300",
            )}
            onClick={() => toggle(r.id)}
          >
            <Checkbox
              id={`mgr-router-${r.id}`}
              checked={selected.includes(r.id)}
              onCheckedChange={() => toggle(r.id)}
              className="pointer-events-none"
            />
            <label htmlFor={`mgr-router-${r.id}`} className="text-sm text-gray-700 cursor-pointer flex-1">
              {r.name}
            </label>
            {selected.includes(r.id) && (
              <ShieldCheck className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
            )}
          </div>
        ))
      )}
    </div>
  );
}

export default function Managers() {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [createKey, setCreateKey] = useState(0);
  const [createError, setCreateError] = useState("");
  const [createRouterIds, setCreateRouterIds] = useState<number[]>([]);
  const [editManager, setEditManager] = useState<Manager | null>(null);
  const [editError, setEditError] = useState("");
  const [editRouterIds, setEditRouterIds] = useState<number[]>([]);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const { data: managers = [], isLoading, refetch } = useQuery<Manager[]>({
    queryKey: ["managers"],
    queryFn: async ({ signal }) => {
      const r = await fetch(`${BASE}/api/managers`, { headers, signal });
      if (!r.ok) throw new Error("Erreur chargement");
      return r.json();
    },
  });

  useRefetchOnEmpty(managers, isLoading, () => void refetch(), (d) => !d || d.length === 0);

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
      const r = await fetch(`${BASE}/api/managers`, { method: "POST", headers, body: JSON.stringify(d) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Erreur"); }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["managers"] });
      setCreateOpen(false);
      setCreateRouterIds([]);
      toast({ title: "Gérant créé" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...d }: { id: number; name?: string; username?: string; password?: string; routerIds?: number[]; isActive?: boolean }) => {
      const r = await fetch(`${BASE}/api/managers/${id}`, { method: "PUT", headers, body: JSON.stringify(d) });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Erreur"); }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["managers"] });
      setEditManager(null);
      toast({ title: "Gérant mis à jour" });
    },
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
      await createMutation.mutateAsync({
        name: data.name,
        username: data.username,
        password: data.password,
        routerIds: createRouterIds,
      });
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "Une erreur est survenue");
    }
  };

  const handleEdit = async (data: PersonFormData) => {
    if (!editManager) return;
    setEditError("");
    try {
      await updateMutation.mutateAsync({
        id: editManager.id,
        name: data.name,
        username: data.username,
        password: data.password,
        routerIds: editRouterIds,
      });
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : "Une erreur est survenue");
    }
  };

  const openEdit = (m: Manager) => {
    setEditError("");
    setEditRouterIds(m.routerIds ?? []);
    setEditManager(m);
  };

  const getRouterNames = (routerIds: number[]) =>
    routerIds.map((id) => routers.find((r) => r.id === id)?.name ?? `Routeur #${id}`);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <UserCog className="h-6 w-6" /> Gérants de zone
          </h1>
        </div>
        <Button
          onClick={() => { setCreateKey((k) => k + 1); setCreateError(""); setCreateRouterIds([]); setCreateOpen(true); }}
          className="gap-2"
          title="Ajouter un gérant"
        >
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
                        <DropdownMenuItem className="py-1.5 text-sm" onClick={() => openEdit(m)}>
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

              <CardContent className="pt-0 pb-3">
                <div className="border-t border-gray-100 pt-2.5">
                  <div className="flex items-center gap-1.5 mb-2">
                    <RouterIcon className="h-3 w-3 text-gray-400" />
                    <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Routeurs assignés</span>
                    {m.routerIds.length > 0 && (
                      <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                        {m.routerIds.length}
                      </span>
                    )}
                  </div>
                  {m.routerIds.length === 0 ? (
                    <p className="text-xs text-gray-400 italic">Aucun — sélection libre (tous les routeurs)</p>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {getRouterNames(m.routerIds).map((name, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200"
                        >
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400 flex-shrink-0" />
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

      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) { setCreateOpen(false); setCreateError(""); setCreateRouterIds([]); } }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Ajouter un gérant de zone</DialogTitle></DialogHeader>

          <div className="pb-2">
            <Label className="text-sm text-gray-700 mb-2 block">Routeurs assignés (optionnel)</Label>
            <RouterMultiSelect
              routers={routers}
              selected={createRouterIds}
              onChange={setCreateRouterIds}
            />
            {createRouterIds.length > 0 ? (
              <p className="text-[11px] text-amber-600 mt-1.5 flex items-center gap-1">
                Le gérant aura accès à {createRouterIds.length} routeur{createRouterIds.length > 1 ? "s" : ""}
              </p>
            ) : (
              <p className="text-[11px] text-gray-500 mt-1.5">
                Sans assignation : le gérant pourra choisir parmi tous les routeurs du tenant.
              </p>
            )}
          </div>

          <PersonForm
            key={createKey}
            onSubmit={handleCreate}
            onCancel={() => { setCreateOpen(false); setCreateError(""); setCreateRouterIds([]); }}
            loading={createMutation.isPending}
            serverError={createError}
            forManager
            nameLabel="Nom complet"
            portalSectionLabel="Accès gérant"
          />
        </DialogContent>
      </Dialog>

      <Dialog open={!!editManager} onOpenChange={(o) => { if (!o) { setEditManager(null); setEditError(""); } }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Modifier le gérant</DialogTitle></DialogHeader>
          {editManager && (
            <>
              <div className="pb-2">
                <Label className="text-sm text-gray-700 mb-2 block">Routeurs assignés (optionnel)</Label>
                <RouterMultiSelect
                  routers={routers}
                  selected={editRouterIds}
                  onChange={setEditRouterIds}
                />
                {editRouterIds.length > 0 ? (
                  <p className="text-[11px] text-amber-600 mt-1.5 flex items-center gap-1">
                    Le gérant aura accès à {editRouterIds.length} routeur{editRouterIds.length > 1 ? "s" : ""}
                  </p>
                ) : (
                  <p className="text-[11px] text-gray-500 mt-1.5">
                    Sans assignation : sélection libre parmi tous les routeurs du tenant.
                  </p>
                )}
              </div>

              <PersonForm
                initial={{ name: editManager.name, username: editManager.username, password: editManager.passwordPlain ?? "" }}
                onSubmit={handleEdit}
                onCancel={() => { setEditManager(null); setEditError(""); }}
                loading={updateMutation.isPending}
                isEdit
                serverError={editError}
                forManager
                nameLabel="Nom complet"
                portalSectionLabel="Accès gérant"
              />
            </>
          )}
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={deleteId !== null}
        onOpenChange={(o) => { if (!o && !deleteMutation.isPending) setDeleteId(null); }}
        title="Supprimer ce gérant ?"
        description="Cette action est irréversible."
        onConfirm={() => void handleDeleteManager()}
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
