import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useListRouterProfiles } from "@workspace/api-client-react";
import { useRouterContext } from "@/contexts/RouterContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { PackageOpen, Clock, Banknote, Users, Wifi, Lock, Plus, Pencil, Trash2, RefreshCw, ArrowRightLeft } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

function formatValidity(v: string | null | undefined): string {
  if (!v) return "Illimité";
  return v
    .replace(/(\d+)h/, "$1 heure(s)")
    .replace(/(\d+)d/, "$1 jour(s)")
    .replace(/(\d+)w/, "$1 semaine(s)");
}

const defaultForm = {
  name: "",
  addrPool: "",
  sharedUsers: "1",
  rateLimit: "",
  expiredMode: "None",
  price: "",
  sellingPrice: "",
  lockMac: false,
  parentQueue: "",
  validity: "",
};

export default function Forfaits() {
  const { role } = useAuth();
  const isManager = role === "manager";
  const { selectedRouterId } = useRouterContext();
  const queryClient = useQueryClient();

  const { data: profiles = [], isLoading: loadingProfiles } = useListRouterProfiles(
    selectedRouterId ?? 0,
    {
      query: {
        enabled: !!selectedRouterId,
        staleTime: 5 * 60_000,
        gcTime: 10 * 60_000,
        refetchOnWindowFocus: false,
        placeholderData: (prev) => prev,
      },
    },
  );

  const [showDialog, setShowDialog] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null); // original name when editing
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pools, setPools] = useState<string[]>([]);
  const [loadingPools, setLoadingPools] = useState(false);
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [refreshingProfiles, setRefreshingProfiles] = useState(false);
  const [syncingNames, setSyncingNames] = useState(false);
  const [syncNamesMsg, setSyncNamesMsg] = useState<string | null>(null);
  const [localProfiles, setLocalProfiles] = useState<(typeof profiles)>([]);

  const localCacheKey = selectedRouterId ? `forfaits-cache:${selectedRouterId}` : null;

  useEffect(() => {
    if (!localCacheKey) {
      setLocalProfiles([]);
      return;
    }
    try {
      const raw = localStorage.getItem(localCacheKey);
      setLocalProfiles(raw ? JSON.parse(raw) : []);
    } catch {
      setLocalProfiles([]);
    }
  }, [localCacheKey]);

  useEffect(() => {
    if (!localCacheKey || profiles.length === 0) return;
    try {
      localStorage.setItem(localCacheKey, JSON.stringify(profiles));
    } catch {
      // ignore quota/serialization issues
    }
  }, [localCacheKey, profiles]);

  const displayedProfiles = useMemo(
    () => (profiles.length > 0 ? profiles : localProfiles),
    [profiles, localProfiles],
  );

  // Auto-sync profiles from MikroTik when opening the Forfaits tab.
  useEffect(() => {
    if (!selectedRouterId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/routers/${selectedRouterId}/profiles?refresh=1`);
        if (!res.ok || cancelled) return;
        const freshProfiles = await res.json();
        if (cancelled) return;
        queryClient.setQueriesData(
          {
            queryKey: ["listRouterProfiles"],
            predicate: (query) =>
              Array.isArray(query.queryKey) && query.queryKey[1] === selectedRouterId,
          },
          freshProfiles,
        );
        queryClient.invalidateQueries({ queryKey: ["listRouterProfiles", selectedRouterId] });
      } catch {
        // Keep current cached values if live sync fails.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedRouterId, queryClient]);

  function setField<K extends keyof typeof defaultForm>(key: K, val: (typeof defaultForm)[K]) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  async function fetchPools() {
    if (!selectedRouterId) return;
    setLoadingPools(true);
    try {
      const res = await fetch(`/api/routers/${selectedRouterId}/pools`);
      if (res.ok) setPools(await res.json());
    } catch { /* ignore */ } finally {
      setLoadingPools(false);
    }
  }

  function openCreate() {
    setError(null);
    setEditingName(null);
    setForm(defaultForm);
    setPools([]);
    setShowDialog(true);
    fetchPools();
  }

  function openEdit(p: (typeof profiles)[0]) {
    setError(null);
    setEditingName(p.name);
    setForm({
      name: p.name,
      addrPool: p.addrPool ?? "",
      sharedUsers: p.sharedUsers ?? "1",
      rateLimit: p.rateLimit ?? "",
      expiredMode: p.expiredMode ?? "None",
      price: p.price ?? "",
      sellingPrice: p.sellingPrice ?? "",
      lockMac: p.lockMac ?? false,
      parentQueue: p.parentQueue ?? "",
      validity: p.validity ?? "",
    });
    setPools([]);
    setShowDialog(true);
    fetchPools();
  }

  async function handleSave() {
    setError(null);
    if (!selectedRouterId) { setError("Sélectionnez un routeur d'abord."); return; }
    if (!form.name.trim() || !form.price.trim() || !form.validity.trim()) {
      setError("Nom, prix et validité sont obligatoires."); return;
    }
    setSaving(true);
    try {
      const url = editingName
        ? `/api/routers/${selectedRouterId}/profiles/${encodeURIComponent(editingName)}`
        : `/api/routers/${selectedRouterId}/profiles`;
      const method = editingName ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Erreur lors de la sauvegarde"); setSaving(false); return; }
      setShowDialog(false);
      setForm(defaultForm);
      setEditingName(null);
      queryClient.invalidateQueries({ queryKey: ["listRouterProfiles", selectedRouterId] });
    } catch {
      setError("Impossible de contacter le serveur.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deletingName || !selectedRouterId) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/routers/${selectedRouterId}/profiles/${encodeURIComponent(deletingName)}`,
        { method: "DELETE" },
      );
      if (res.ok) {
        setDeletingName(null);
        queryClient.invalidateQueries({ queryKey: ["listRouterProfiles", selectedRouterId] });
      }
    } catch { /* ignore */ } finally {
      setDeleting(false);
    }
  }

  async function handleForceRefreshProfiles() {
    if (!selectedRouterId) return;
    setRefreshingProfiles(true);
    try {
      const res = await fetch(`/api/routers/${selectedRouterId}/profiles?refresh=1`);
      if (!res.ok) throw new Error("refresh failed");
      const freshProfiles = await res.json();
      queryClient.setQueriesData(
        {
          queryKey: ["listRouterProfiles"],
          predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[1] === selectedRouterId,
        },
        freshProfiles,
      );
      queryClient.invalidateQueries({ queryKey: ["listRouterProfiles", selectedRouterId] });
    } catch {
      // keep current cached data if refresh fails
    } finally {
      setRefreshingProfiles(false);
    }
  }

  async function handleSyncNames() {
    if (!selectedRouterId) return;
    setSyncingNames(true);
    setSyncNamesMsg(null);
    try {
      const res = await fetch(`/api/routers/${selectedRouterId}/profiles/sync-names`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSyncNamesMsg(`Erreur: ${(body as { error?: string }).error ?? res.statusText}`);
      } else {
        setSyncNamesMsg("Noms synchronisés avec succès");
        queryClient.invalidateQueries({ queryKey: ["listRouterProfiles", selectedRouterId] });
        setTimeout(() => setSyncNamesMsg(null), 4000);
      }
    } catch (e) {
      setSyncNamesMsg(`Erreur: ${String(e)}`);
    } finally {
      setSyncingNames(false);
    }
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Forfaits</h1>
          <p className="text-sm text-gray-500">Profils hotspot disponibles sur vos routeurs MikroTik</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={handleForceRefreshProfiles}
            disabled={!selectedRouterId || refreshingProfiles}
            className="gap-2"
            title="Actualiser maintenant"
          >
            <RefreshCw className={`h-4 w-4 ${refreshingProfiles ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">{refreshingProfiles ? "Actualisation..." : "Actualiser maintenant"}</span>
          </Button>
          <Button
            variant="outline"
            onClick={handleSyncNames}
            disabled={!selectedRouterId || syncingNames}
            className="gap-2"
            title="Détecter et appliquer les renommages de forfaits MikroTik"
          >
            <ArrowRightLeft className={`h-4 w-4 ${syncingNames ? "animate-pulse" : ""}`} />
            <span className="hidden sm:inline">{syncingNames ? "Sync noms..." : "Sync noms"}</span>
          </Button>
          {!isManager && (
            <Button onClick={openCreate} disabled={!selectedRouterId} className="gap-2" title="Ajouter un forfait">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Ajouter un forfait</span>
            </Button>
          )}
        </div>
      </div>

      {syncNamesMsg && (
        <div className={`mb-4 rounded-md px-4 py-2 text-sm font-medium ${syncNamesMsg.startsWith("Erreur") ? "bg-red-50 text-red-700 border border-red-200" : "bg-green-50 text-green-700 border border-green-200"}`}>
          {syncNamesMsg}
        </div>
      )}

      {!selectedRouterId && (
        <Card>
          <CardContent className="py-16 text-center">
            <PackageOpen className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">Sélectionnez un routeur dans la barre latérale</p>
            <p className="text-sm text-gray-400 mt-1">Les forfaits disponibles s&apos;afficheront ici</p>
          </CardContent>
        </Card>
      )}

      {selectedRouterId && loadingProfiles && displayedProfiles.length === 0 && (
        <div className="text-sm text-gray-400">Chargement des forfaits...</div>
      )}

      {selectedRouterId && !loadingProfiles && displayedProfiles.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-gray-500">Aucun profil trouvé sur ce routeur.</p>
          </CardContent>
        </Card>
      )}

      {displayedProfiles.length > 0 && (
        <>
          <p className="text-sm text-gray-500 mb-4">{displayedProfiles.length} forfait(s) trouvé(s)</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {displayedProfiles.map((p) => (
              <Card key={p.name} className="hover:shadow-md transition-shadow">
                <div className="flex p-4 gap-2">
                  <div className="flex-1 min-w-0 space-y-2">
                    <p className="text-base font-bold text-gray-900 truncate" title={p.name}>{p.name}</p>

                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                      <span className="text-gray-700">{formatValidity(p.validity)}</span>
                    </div>

                    {p.price && p.price !== "0" ? (
                      <div className="flex items-center gap-2 text-sm">
                        <Banknote className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                        <span className="fit-price text-gray-700 font-semibold">{p.price} FCFA</span>
                      </div>
                    ) : null}

                    {p.sharedUsers && (
                      <div className="flex items-center gap-2 text-sm">
                        <Users className="h-3.5 w-3.5 text-purple-500 flex-shrink-0" />
                        <span className="text-gray-700">{p.sharedUsers} appareil(s)</span>
                      </div>
                    )}

                    {p.rateLimit && (
                      <div className="flex items-center gap-2 text-sm">
                        <Wifi className="h-3.5 w-3.5 text-orange-500 flex-shrink-0" />
                        <span className="text-gray-600 text-xs font-mono">{p.rateLimit}</span>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {p.lockMac && (
                        <Badge variant="outline" className="text-xs text-amber-600 border-amber-200 gap-1">
                          <Lock className="h-2.5 w-2.5" /> MAC verrouillé
                        </Badge>
                      )}
                      {(!p.price || p.price === "0") && (
                        <Badge variant="outline" className="text-xs text-blue-600 border-blue-200">
                          Promo / Gratuit
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col items-center justify-between flex-shrink-0">
                    <button
                      onClick={() => openEdit(p)}
                      className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
                      title="Modifier"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    {!isManager && (
                      <button
                        onClick={() => setDeletingName(p.name)}
                        className="p-1 rounded hover:bg-red-50 text-red-400 hover:text-red-600 transition-colors"
                        title="Supprimer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      <AlertDialog open={deletingName !== null} onOpenChange={(open) => { if (!open) setDeletingName(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer le forfait ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le profil <span className="font-semibold text-gray-900">{deletingName}</span> sera supprimé définitivement du routeur MikroTik. Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-500"
            >
              {deleting ? "Suppression…" : "Supprimer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-md max-h-[90vh] flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>
              {editingName ? `Modifier — ${editingName}` : "Ajouter un forfait"}
            </DialogTitle>
          </DialogHeader>

          <div className="overflow-y-auto flex-1 pr-1">
          <div className="form-shell grid grid-cols-1 sm:grid-cols-2 gap-3 py-1">

            <div className="col-span-2 space-y-1.5">
              <Label>Nom <span className="text-red-500">*</span></Label>
              <Input
                placeholder="ex: 3-Heure"
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
              />
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label>Pool d&apos;adresses</Label>
              <Select
                value={form.addrPool || "__none"}
                onValueChange={(v) => setField("addrPool", v === "__none" ? "" : v)}
                disabled={loadingPools}
              >
                <SelectTrigger>
                  <SelectValue placeholder={loadingPools ? "Chargement…" : "Sélectionner un pool"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Aucun</SelectItem>
                  {pools.map((pool) => (
                    <SelectItem key={pool} value={pool}>{pool}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Utilisateurs simultanés</Label>
              <Input
                placeholder="1"
                type="number"
                min="1"
                value={form.sharedUsers}
                onChange={(e) => setField("sharedUsers", e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Débit max [UP/DOWN]</Label>
              <Input
                placeholder="ex: 1M/1M"
                value={form.rateLimit}
                onChange={(e) => setField("rateLimit", e.target.value)}
              />
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label>Mode d&apos;expiration</Label>
              <Select value={form.expiredMode} onValueChange={(v) => setField("expiredMode", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="None">Aucun</SelectItem>
                  <SelectItem value="Remove">Supprimer</SelectItem>
                  <SelectItem value="Notice">Avertir</SelectItem>
                  <SelectItem value="Remove & Record">Supprimer &amp; Enregistrer</SelectItem>
                  <SelectItem value="Notice & Record">Avertir &amp; Enregistrer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Prix FCFA <span className="text-red-500">*</span></Label>
              <Input
                placeholder="ex: 100"
                type="number"
                min="0"
                value={form.price}
                onChange={(e) => setField("price", e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Prix de vente FCFA</Label>
              <Input
                placeholder="ex: 150"
                type="number"
                min="0"
                value={form.sellingPrice}
                onChange={(e) => setField("sellingPrice", e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Validité <span className="text-red-500">*</span></Label>
              <Input
                placeholder="ex: 3h, 1d, 7d"
                value={form.validity}
                onChange={(e) => setField("validity", e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>File parente</Label>
              <Input
                placeholder="ex: PCQ-queue"
                value={form.parentQueue}
                onChange={(e) => setField("parentQueue", e.target.value)}
              />
            </div>

            <div className="col-span-2 flex items-center gap-3 pt-1">
              <Switch
                id="lockMac"
                checked={form.lockMac}
                onCheckedChange={(v) => setField("lockMac", v)}
              />
              <Label htmlFor="lockMac" className="cursor-pointer">
                <Lock className="h-3.5 w-3.5 inline mr-1 text-amber-500" />
                Verrouillage utilisateur (MAC)
              </Label>
            </div>

          </div>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 flex-shrink-0">{error}</p>
          )}

          <DialogFooter className="flex-shrink-0 pt-2">
            <Button variant="outline" onClick={() => setShowDialog(false)} disabled={saving}>
              Annuler
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Sauvegarde…" : editingName ? "Enregistrer" : "Créer le forfait"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
