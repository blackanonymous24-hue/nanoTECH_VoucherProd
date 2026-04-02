import { useState } from "react";
import { useLocation } from "wouter";
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
import { Users, Plus, Trash2, Phone, Check, X, Mail, KeyRound, ExternalLink, Pencil, Tag } from "lucide-react";
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

export type PersonFormData = {
  name: string;
  phone: string;
  email: string;
  username: string;
  password: string;
  commentSuffix: string;
  commentSuffix2: string;
};

export function PersonForm({
  initial,
  onSubmit,
  onCancel,
  loading,
  isEdit,
  serverError,
  forManager = false,
  nameLabel = "Nom",
  usernameLabel = "Nom d'utilisateur",
  portalSectionLabel = "Accès portail vendeur",
}: {
  initial?: Partial<{
    name: string;
    phone: string | null;
    email: string | null;
    username: string | null;
    commentSuffix: string | null;
    commentSuffix2: string | null;
  }>;
  onSubmit: (data: PersonFormData) => void;
  onCancel: () => void;
  loading: boolean;
  isEdit?: boolean;
  serverError?: string;
  forManager?: boolean;
  nameLabel?: string;
  usernameLabel?: string;
  portalSectionLabel?: string;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState("");
  const [commentSuffix, setCommentSuffix] = useState(initial?.commentSuffix ?? "");
  const [commentSuffix2, setCommentSuffix2] = useState(initial?.commentSuffix2 ?? "");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ name, phone, email, username, password, commentSuffix, commentSuffix2 });
      }}
      className="flex flex-col gap-0"
    >
      {/* Scrollable fields */}
      <div className="overflow-y-auto px-1 space-y-3" style={{ maxHeight: "calc(90vh - 180px)" }}>
        {serverError && (
          <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            {serverError}
          </div>
        )}

        <div>
          <Label htmlFor="pf-name">{nameLabel} *</Label>
          <Input
            id="pf-name"
            className="mt-1"
            placeholder={forManager ? "ex: Jean Dupont" : "ex: JEAN DUPONT"}
            value={name}
            onChange={(e) => setName(forManager ? e.target.value : e.target.value.toUpperCase())}
            required
            autoFocus
          />
        </div>

        {!forManager && (
          <>
            <div>
              <Label htmlFor="pf-phone">
                Téléphone <span className="text-gray-400 text-xs">(optionnel)</span>
              </Label>
              <Input
                id="pf-phone"
                className="mt-1"
                placeholder="ex: +225 07 00 00 00"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="pf-email">
                Email <span className="text-gray-400 text-xs">(optionnel)</span>
              </Label>
              <Input
                id="pf-email"
                type="email"
                className="mt-1"
                placeholder="ex: jean@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </>
        )}

        <div className="pt-2 border-t">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            {portalSectionLabel}
          </p>
          <div className="space-y-2">
            <div>
              <Label htmlFor="pf-username">
                {usernameLabel}
                {!forManager && (
                  <span className="text-gray-400 text-xs ml-1">(vide = utilise le téléphone)</span>
                )}
              </Label>
              <Input
                id="pf-username"
                className="mt-1"
                placeholder="ex: jean.dupont"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="pf-password">
                {isEdit ? "Nouveau mot de passe" : "Mot de passe"}
                <span className="text-gray-400 text-xs ml-1">
                  {isEdit ? "(laisser vide = inchangé)" : "(min. 4 caractères)"}
                </span>
              </Label>
              <Input
                id="pf-password"
                type="password"
                className="mt-1"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>
        </div>

        {!forManager && (
          <div className="pt-2 border-t">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Identifiants de lot <span className="font-normal normal-case text-gray-400">(optionnels)</span>
            </p>
            <p className="text-xs text-gray-400 mb-2">
              Les vouchers dont le commentaire se termine par l'un de ces identifiants seront automatiquement attribués à ce vendeur.
            </p>
            <div className="space-y-2">
              <div>
                <Label htmlFor="pf-suffix">Identifiant 1</Label>
                <Input
                  id="pf-suffix"
                  className="mt-1 font-mono"
                  placeholder="ex: HOME"
                  value={commentSuffix}
                  onChange={(e) => setCommentSuffix(e.target.value.toUpperCase())}
                />
              </div>
              <div>
                <Label htmlFor="pf-suffix2">Identifiant 2</Label>
                <Input
                  id="pf-suffix2"
                  className="mt-1 font-mono"
                  placeholder="ex: BUREAU"
                  value={commentSuffix2}
                  onChange={(e) => setCommentSuffix2(e.target.value.toUpperCase())}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Fixed footer */}
      <DialogFooter className="pt-4 mt-2 border-t">
        <Button type="button" variant="outline" onClick={onCancel}>
          Annuler
        </Button>
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
  const [, navigate] = useLocation();
  const createMutation = useCreateVendor();
  const updateMutation = useUpdateVendor();
  const deleteMutation = useDeleteVendor();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState<string>("");
  const [editVendor, setEditVendor] = useState<Vendor | null>(null);
  const [editError, setEditError] = useState<string>("");
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

  const handleCreate = async (data: PersonFormData) => {
    setCreateError("");
    try {
      await createMutation.mutateAsync({
        data: {
          name: data.name,
          phone: data.phone || null,
          email: data.email || null,
          username: data.username || null,
          ...(data.password ? { password: data.password } : {}),
          ...(selectedRouterId ? { routerId: selectedRouterId } : {}),
          ...(data.commentSuffix ? { commentSuffix: data.commentSuffix } : {}),
          ...(data.commentSuffix2 ? { commentSuffix2: data.commentSuffix2 } : {}),
        } as any,
      });
      invalidate();
      setShowCreate(false);
      toast({ title: "Vendeur créé avec succès" });
    } catch (err: any) {
      const msg =
        err?.response?.data?.error ??
        err?.message ??
        "Une erreur est survenue";
      setCreateError(msg);
    }
  };

  const handleEdit = async (data: PersonFormData) => {
    if (!editVendor) return;
    setEditError("");
    try {
      await updateMutation.mutateAsync({
        id: editVendor.id,
        data: {
          name: data.name,
          phone: data.phone || null,
          email: data.email || null,
          username: data.username || null,
          ...(data.password ? { password: data.password } : {}),
          commentSuffix: data.commentSuffix || null,
          commentSuffix2: data.commentSuffix2 || null,
        } as any,
      });
      invalidate();
      setEditVendor(null);
      toast({ title: "Vendeur mis à jour" });
    } catch (err: any) {
      const msg =
        err?.response?.data?.error ??
        err?.message ??
        "Une erreur est survenue";
      setEditError(msg);
    }
  };

  const handleToggleActive = async (vendor: Vendor) => {
    try {
      await updateMutation.mutateAsync({
        id: vendor.id,
        data: { isActive: !vendor.isActive },
      });
      invalidate();
      toast({ title: `Vendeur ${vendor.isActive ? "désactivé" : "activé"}` });
    } catch {
      toast({ title: "Erreur", description: "Impossible de modifier le statut", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!deleteVendorId) return;
    try {
      await deleteMutation.mutateAsync({ id: deleteVendorId });
      invalidate();
      setDeleteVendorId(null);
      toast({ title: "Vendeur supprimé" });
    } catch {
      toast({ title: "Erreur", description: "Impossible de supprimer le vendeur", variant: "destructive" });
    }
  };

  const handleViewReport = (vendorId: number) => {
    sessionStorage.setItem("vouchernet_report_vendor_id", String(vendorId));
    navigate("/reports");
  };

  const portalBase = import.meta.env.BASE_URL.replace(/\/$/, "");

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vendeurs</h1>
          <p className="text-sm text-gray-500">
            {selectedRouterId
              ? "Vendeurs du routeur sélectionné"
              : "Sélectionnez un routeur pour gérer ses vendeurs"}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => window.open(`${portalBase}/vendor-portal`, "_blank")}
          >
            <ExternalLink className="h-4 w-4" /> Portail vendeur
          </Button>
          {!isManager && (
            <Button
              onClick={() => { setCreateError(""); setShowCreate(true); }}
              className="gap-2"
              disabled={!selectedRouterId}
            >
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
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Users className="h-12 w-12 text-gray-300 mb-4" />
            <p className="text-gray-500 font-medium">Aucun vendeur enregistré</p>
            <p className="text-sm text-gray-400 mt-1">Ajoutez votre premier vendeur pour commencer</p>
            <Button className="mt-4 gap-2" onClick={() => { setCreateError(""); setShowCreate(true); }}>
              <Plus className="h-4 w-4" /> Ajouter un vendeur
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {vendors.map((vendor) => (
            <Card key={vendor.id} className={`hover:shadow-md transition-shadow ${vendor.isActive ? "" : "opacity-60"}`}>
              {/* Partie info — cliquable → rapport vendeur */}
              <CardHeader
                className="pb-3 cursor-pointer group"
                onClick={() => handleViewReport(vendor.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-200 transition-colors">
                      <Users className="h-5 w-5 text-blue-600" />
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="text-base group-hover:text-blue-700 transition-colors">
                        {vendor.name}
                      </CardTitle>
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
                      {((vendor as any).commentSuffix || (vendor as any).commentSuffix2) && (
                        <div className="flex items-center gap-1 text-xs text-orange-500 mt-0.5">
                          <Tag className="h-3 w-3 flex-shrink-0" />
                          <span className="font-mono">
                            {[(vendor as any).commentSuffix, (vendor as any).commentSuffix2]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  <Badge variant={vendor.isActive ? "default" : "secondary"} className="flex-shrink-0 mt-0.5">
                    {vendor.isActive ? "Actif" : "Inactif"}
                  </Badge>
                </div>
              </CardHeader>

              {/* Boutons d'action visibles */}
              <CardContent className="pt-0">
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 gap-1.5"
                    onClick={() => { setEditError(""); setEditVendor(vendor); }}
                  >
                    <Pencil className="h-3.5 w-3.5" /> Modifier
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className={`gap-1.5 ${vendor.isActive
                      ? "text-orange-500 hover:text-orange-700 hover:bg-orange-50 border-orange-200"
                      : "text-green-600 hover:text-green-700 hover:bg-green-50 border-green-200"}`}
                    onClick={() => handleToggleActive(vendor)}
                    title={vendor.isActive ? "Désactiver" : "Activer"}
                  >
                    {vendor.isActive
                      ? <><X className="h-3.5 w-3.5" /> Désactiver</>
                      : <><Check className="h-3.5 w-3.5" /> Activer</>}
                  </Button>
                  {!isManager && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-500 hover:text-red-600 hover:bg-red-50 border-red-200"
                      onClick={() => setDeleteVendorId(vendor.id)}
                      title="Supprimer"
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

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={(o) => { if (!o) { setShowCreate(false); setCreateError(""); } }}>
        <DialogContent className="max-w-md w-full">
          <DialogHeader>
            <DialogTitle>Ajouter un vendeur</DialogTitle>
          </DialogHeader>
          <PersonForm
            onSubmit={handleCreate}
            onCancel={() => { setShowCreate(false); setCreateError(""); }}
            loading={createMutation.isPending}
            serverError={createError}
            nameLabel="Nom du vendeur"
          />
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editVendor} onOpenChange={(o) => { if (!o) { setEditVendor(null); setEditError(""); } }}>
        <DialogContent className="max-w-md w-full">
          <DialogHeader>
            <DialogTitle>Modifier le vendeur</DialogTitle>
          </DialogHeader>
          {editVendor && (
            <PersonForm
              initial={{
                name: editVendor.name,
                phone: editVendor.phone ?? null,
                email: (editVendor as any).email ?? null,
                username: (editVendor as any).username ?? null,
                commentSuffix: (editVendor as any).commentSuffix ?? null,
                commentSuffix2: (editVendor as any).commentSuffix2 ?? null,
              }}
              onSubmit={handleEdit}
              onCancel={() => { setEditVendor(null); setEditError(""); }}
              loading={updateMutation.isPending}
              isEdit
              serverError={editError}
              nameLabel="Nom du vendeur"
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
