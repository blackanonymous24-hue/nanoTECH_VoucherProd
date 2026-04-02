import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  useCreateVendor,
  useUpdateVendor,
  useDeleteVendor,
} from "@workspace/api-client-react";
import type { Vendor } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouterContext } from "@/contexts/RouterContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Users, Plus, Pencil, Trash2, Phone, Check, X, Mail, KeyRound, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type FormData = {
  name: string;
  phone: string;
  email: string;
  username: string;
  password: string;
};

function VendorForm({
  initial,
  onSubmit,
  onCancel,
  loading,
  isEdit,
}: {
  initial?: Partial<Vendor & { username?: string; email?: string }>;
  onSubmit: (data: FormData) => void;
  onCancel: () => void;
  loading: boolean;
  isEdit?: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState((initial as any)?.email ?? "");
  const [username, setUsername] = useState((initial as any)?.username ?? "");
  const [password, setPassword] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ name, phone, email, username, password });
      }}
      className="space-y-4"
    >
      <div>
        <Label htmlFor="v-name">Nom du vendeur *</Label>
        <Input
          id="v-name"
          className="mt-1"
          placeholder="ex: Jean Dupont"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
        />
      </div>

      <div>
        <Label htmlFor="v-phone">Téléphone <span className="text-gray-400 text-xs">(optionnel)</span></Label>
        <Input
          id="v-phone"
          className="mt-1"
          placeholder="ex: +225 07 00 00 00"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>

      <div>
        <Label htmlFor="v-email">Email <span className="text-gray-400 text-xs">(optionnel)</span></Label>
        <Input
          id="v-email"
          type="email"
          className="mt-1"
          placeholder="ex: jean@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div className="pt-2 border-t">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Accès au portail vendeur</p>
        <div className="space-y-3">
          <div>
            <Label htmlFor="v-username">Nom d'utilisateur</Label>
            <Input
              id="v-username"
              className="mt-1"
              placeholder="ex: jean2025"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="v-password">
              {isEdit ? "Nouveau mot de passe" : "Mot de passe"}
              <span className="text-gray-400 text-xs ml-1">{isEdit ? "(laisser vide = inchangé)" : "(min. 6 caractères)"}</span>
            </Label>
            <Input
              id="v-password"
              type="password"
              className="mt-1"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={isEdit ? 0 : undefined}
            />
          </div>
        </div>
      </div>

      <DialogFooter className="pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>Annuler</Button>
        <Button type="submit" disabled={loading || !name.trim()}>
          {loading ? "Enregistrement..." : "Enregistrer"}
        </Button>
      </DialogFooter>
    </form>
  );
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function Vendors() {
  const { selectedRouterId } = useRouterContext();
  const { role } = useAuth();
  const isManager = role === "manager";
  const createMutation = useCreateVendor();
  const updateMutation = useUpdateVendor();
  const deleteMutation = useDeleteVendor();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [showCreate, setShowCreate] = useState(false);
  const [editVendor, setEditVendor] = useState<Vendor | null>(null);
  const [deleteVendorId, setDeleteVendorId] = useState<number | null>(null);

  const { data: vendors = [], isLoading, refetch: refetchVendors } = useQuery<Vendor[]>({
    queryKey: ["vendors", selectedRouterId],
    queryFn: async () => {
      const url = selectedRouterId
        ? `${BASE}/api/vendors?routerId=${selectedRouterId}`
        : `${BASE}/api/vendors`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<Vendor[]>;
    },
    staleTime: 30_000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["vendors", selectedRouterId] });
    void refetchVendors();
  };

  const handleCreate = async (data: FormData) => {
    await createMutation.mutateAsync({
      data: {
        name: data.name,
        phone: data.phone || null,
        email: data.email || null,
        username: data.username || null,
        ...(data.password ? { password: data.password } : {}),
        ...(selectedRouterId ? { routerId: selectedRouterId } : {}),
      } as any,
    });
    invalidate();
    setShowCreate(false);
    toast({ title: "Vendeur créé avec succès" });
  };

  const handleEdit = async (data: FormData) => {
    if (!editVendor) return;
    await updateMutation.mutateAsync({
      id: editVendor.id,
      data: {
        name: data.name,
        phone: data.phone || null,
        email: data.email || null,
        username: data.username || null,
        ...(data.password ? { password: data.password } : {}),
      } as any,
    });
    invalidate();
    setEditVendor(null);
    toast({ title: "Vendeur mis à jour" });
  };

  const handleToggleActive = async (vendor: Vendor) => {
    await updateMutation.mutateAsync({
      id: vendor.id,
      data: { isActive: !vendor.isActive },
    });
    invalidate();
    toast({ title: `Vendeur ${vendor.isActive ? "désactivé" : "activé"}` });
  };

  const handleDelete = async () => {
    if (!deleteVendorId) return;
    await deleteMutation.mutateAsync({ id: deleteVendorId });
    invalidate();
    setDeleteVendorId(null);
    toast({ title: "Vendeur supprimé" });
  };

  const portalBase = import.meta.env.BASE_URL.replace(/\/$/, "");

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vendeurs</h1>
          <p className="text-sm text-gray-500">
            {selectedRouterId
              ? "Vendeurs du routeur sélectionné"
              : "Sélectionnez un routeur pour gérer ses vendeurs"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => window.open(`${portalBase}/vendor-portal`, "_blank")}
          >
            <ExternalLink className="h-4 w-4" /> Portail vendeur
          </Button>
          {!isManager && (
            <Button onClick={() => setShowCreate(true)} className="gap-2" disabled={!selectedRouterId}>
              <Plus className="h-4 w-4" /> Ajouter un vendeur
            </Button>
          )}
        </div>
      </div>

      {!selectedRouterId && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded-lg mb-6 text-sm">
          <Users className="h-4 w-4 flex-shrink-0" />
          Sélectionnez un routeur dans la barre latérale pour afficher et gérer les vendeurs associés.
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Chargement...</div>
      ) : vendors.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Users className="h-12 w-12 text-gray-300 mb-4" />
            <p className="text-gray-500 font-medium">Aucun vendeur enregistré</p>
            <p className="text-sm text-gray-400 mt-1">Ajoutez votre premier vendeur pour commencer</p>
            <Button className="mt-4 gap-2" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" /> Ajouter un vendeur
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {vendors.map((vendor) => (
            <Card key={vendor.id} className={vendor.isActive ? "" : "opacity-60"}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <Users className="h-5 w-5 text-blue-600" />
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="text-base">{vendor.name}</CardTitle>
                      {vendor.phone && (
                        <div className="flex items-center gap-1 text-xs text-gray-500 mt-0.5">
                          <Phone className="h-3 w-3 flex-shrink-0" />
                          {vendor.phone}
                        </div>
                      )}
                      {(vendor as any).email && (
                        <div className="flex items-center gap-1 text-xs text-gray-500 mt-0.5">
                          <Mail className="h-3 w-3 flex-shrink-0" />
                          {(vendor as any).email}
                        </div>
                      )}
                      {(vendor as any).username && (
                        <div className="flex items-center gap-1 text-xs text-blue-500 mt-0.5">
                          <KeyRound className="h-3 w-3 flex-shrink-0" />
                          @{(vendor as any).username}
                        </div>
                      )}
                    </div>
                  </div>
                  <Badge variant={vendor.isActive ? "default" : "secondary"}>
                    {vendor.isActive ? "Actif" : "Inactif"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 gap-1.5"
                    onClick={() => setEditVendor(vendor)}
                  >
                    <Pencil className="h-3.5 w-3.5" /> Modifier
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => handleToggleActive(vendor)}
                    title={vendor.isActive ? "Désactiver" : "Activer"}
                  >
                    {vendor.isActive ? <X className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                  </Button>
                  {!isManager && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 text-red-500 hover:text-red-600 hover:bg-red-50"
                      onClick={() => setDeleteVendorId(vendor.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Ajouter un vendeur</DialogTitle>
          </DialogHeader>
          <VendorForm
            onSubmit={handleCreate}
            onCancel={() => setShowCreate(false)}
            loading={createMutation.isPending}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={!!editVendor} onOpenChange={(o) => { if (!o) setEditVendor(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Modifier le vendeur</DialogTitle>
          </DialogHeader>
          {editVendor && (
            <VendorForm
              initial={editVendor}
              onSubmit={handleEdit}
              onCancel={() => setEditVendor(null)}
              loading={updateMutation.isPending}
              isEdit
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteVendorId} onOpenChange={(o) => { if (!o) setDeleteVendorId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce vendeur ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. Les vouchers attribués à ce vendeur ne seront plus liés à lui.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={handleDelete}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
