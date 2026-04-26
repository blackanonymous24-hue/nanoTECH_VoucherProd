import { useEffect, useMemo, useState } from "react";
import { useRouterContext } from "@/contexts/RouterContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { ShieldCheck, RefreshCw, Plus, Search, Trash2, Pencil, ShieldOff, ShieldAlert } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type BindingType = "bypassed" | "blocked" | "regular";

interface IpBinding {
  id: string;
  macAddress: string;
  address: string;
  toAddress: string;
  type: BindingType;
  server: string;
  comment: string;
  disabled: boolean;
}

interface BindingFormState {
  macAddress: string;
  address: string;
  toAddress: string;
  server: string;
  type: BindingType;
  comment: string;
  disabled: boolean;
}

const EMPTY_FORM: BindingFormState = {
  macAddress: "",
  address: "",
  toAddress: "",
  server: "",
  type: "bypassed",
  comment: "",
  disabled: false,
};

const MAC_RE = /^[0-9A-Fa-f]{2}([:-][0-9A-Fa-f]{2}){5}$/;

function typeBadge(type: BindingType) {
  if (type === "bypassed") {
    return (
      <Badge variant="outline" className="gap-1 text-green-600 border-green-200 bg-green-50">
        <ShieldCheck className="h-3 w-3" />
        Bypass
      </Badge>
    );
  }
  if (type === "blocked") {
    return (
      <Badge variant="outline" className="gap-1 text-red-600 border-red-200 bg-red-50">
        <ShieldOff className="h-3 w-3" />
        Bloqué
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-gray-600 border-gray-200 bg-gray-50">
      <ShieldAlert className="h-3 w-3" />
      Standard
    </Badge>
  );
}

export default function IpBindings() {
  const { selectedRouterId } = useRouterContext();
  const { toast } = useToast();

  const [bindings, setBindings] = useState<IpBinding[] | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [search, setSearch]     = useState("");

  // Add / edit dialog
  const [editing, setEditing]   = useState<IpBinding | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm]         = useState<BindingFormState>(EMPTY_FORM);
  const [saving, setSaving]     = useState(false);

  // Delete confirm
  const [confirmDelete, setConfirmDelete] = useState<IpBinding | null>(null);
  const [deleting, setDeleting]           = useState(false);

  const refresh = async () => {
    if (!selectedRouterId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/routers/${selectedRouterId}/ip-bindings`);
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { bindings: IpBinding[] };
      setBindings(data.bindings);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setBindings(null);
    if (selectedRouterId) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRouterId]);

  const filtered = useMemo(() => {
    if (!bindings) return [];
    if (!search.trim()) return bindings;
    const q = search.toLowerCase();
    return bindings.filter(
      (b) =>
        b.macAddress.toLowerCase().includes(q) ||
        b.address.toLowerCase().includes(q) ||
        b.toAddress.toLowerCase().includes(q) ||
        b.comment.toLowerCase().includes(q),
    );
  }, [bindings, search]);

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (b: IpBinding) => {
    setEditing(b);
    setForm({
      macAddress: b.macAddress,
      address:    b.address,
      toAddress:  b.toAddress,
      // "all" est le placeholder MikroTik pour "tous les serveurs" → on l'efface
      // dans le formulaire pour ne pas l'envoyer comme une valeur explicite.
      server:     b.server === "all" ? "" : b.server,
      type:       b.type,
      comment:    b.comment,
      disabled:   b.disabled,
    });
    setFormOpen(true);
  };

  const submitForm = async () => {
    if (!selectedRouterId) return;
    const mac  = form.macAddress.trim();
    const addr = form.address.trim();
    if (!mac && !addr) {
      toast({ title: "Champ requis", description: "Indiquez une adresse MAC ou IP.", variant: "destructive" });
      return;
    }
    if (mac && !MAC_RE.test(mac)) {
      toast({
        title: "Adresse MAC invalide",
        description: "Format attendu : AA:BB:CC:DD:EE:FF",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const url = editing
        ? `${BASE}/api/routers/${selectedRouterId}/ip-bindings/${encodeURIComponent(editing.id)}`
        : `${BASE}/api/routers/${selectedRouterId}/ip-bindings`;
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          macAddress: mac,
          address:    addr,
          toAddress:  form.toAddress.trim(),
          server:     form.server.trim(),  // vide → "all" côté MikroTik
          type:       form.type,
          comment:    form.comment.trim(),
          disabled:   form.disabled,
        }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      toast({
        title: editing ? "Liaison modifiée" : "Liaison ajoutée",
        description: mac || addr,
      });
      setFormOpen(false);
      await refresh();
    } catch (e) {
      toast({
        title: editing ? "Erreur de modification" : "Erreur d'ajout",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const toggleDisabled = async (b: IpBinding) => {
    if (!selectedRouterId) return;
    // Optimistic update — revert on error.
    setBindings((cur) =>
      cur ? cur.map((x) => (x.id === b.id ? { ...x, disabled: !b.disabled } : x)) : cur,
    );
    try {
      const res = await fetch(
        `${BASE}/api/routers/${selectedRouterId}/ip-bindings/${encodeURIComponent(b.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ disabled: !b.disabled }),
        },
      );
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
    } catch (e) {
      // Revert
      setBindings((cur) =>
        cur ? cur.map((x) => (x.id === b.id ? { ...x, disabled: b.disabled } : x)) : cur,
      );
      toast({
        title: "Erreur",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete || !selectedRouterId) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `${BASE}/api/routers/${selectedRouterId}/ip-bindings/${encodeURIComponent(confirmDelete.id)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      toast({
        title: "Liaison supprimée",
        description: confirmDelete.macAddress || confirmDelete.address,
      });
      setConfirmDelete(null);
      await refresh();
    } catch (e) {
      toast({
        title: "Erreur de suppression",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Bypass MAC</h1>
          <p className="text-sm text-gray-500">
            Autorisez certaines adresses MAC à contourner le portail captif (équivalent IP-binding de Winbox).
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {selectedRouterId && (
            <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading} className="gap-2">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Actualiser</span>
            </Button>
          )}
          {selectedRouterId && (
            <Button size="sm" onClick={openAdd} className="gap-2">
              <Plus className="h-4 w-4" />
              Nouveau bypass
            </Button>
          )}
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        {selectedRouterId && bindings && bindings.length > 0 && (
          <div className="relative flex-1 min-w-48 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            <Input
              className="pl-9"
              placeholder="Rechercher MAC, IP, commentaire…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        )}
        {selectedRouterId && bindings && (
          <Badge variant="outline" className="gap-1.5 text-blue-600 border-blue-200">
            <ShieldCheck className="h-3 w-3" />
            {search ? `${filtered.length} / ${bindings.length}` : bindings.length} liaison(s)
          </Badge>
        )}
      </div>

      {!selectedRouterId && (
        <Card>
          <CardContent className="py-16 text-center">
            <ShieldCheck className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">Sélectionnez un routeur dans la barre latérale</p>
            <p className="text-sm text-gray-400 mt-1">Les liaisons MAC s&apos;afficheront ici</p>
          </CardContent>
        </Card>
      )}

      {selectedRouterId && loading && bindings === null && (
        <div className="text-sm text-gray-400">Chargement des liaisons…</div>
      )}

      {selectedRouterId && error && (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-red-500 text-sm">{error}</p>
          </CardContent>
        </Card>
      )}

      {selectedRouterId && bindings && bindings.length === 0 && !loading && !error && (
        <Card>
          <CardContent className="py-12 text-center">
            <ShieldCheck className="h-10 w-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">Aucune liaison configurée</p>
            <p className="text-sm text-gray-400 mt-1">
              Cliquez sur &laquo; Nouveau bypass &raquo; pour autoriser un appareil à se connecter sans portail.
            </p>
          </CardContent>
        </Card>
      )}

      {selectedRouterId && bindings && bindings.length > 0 && filtered.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center">
            <Search className="h-8 w-8 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">Aucun résultat pour « {search} »</p>
          </CardContent>
        </Card>
      )}

      {selectedRouterId && filtered.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-blue-500" />
              Liaisons MAC / IP
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table className="min-w-[720px]">
              <TableHeader>
                <TableRow className="bg-gray-50">
                  <TableHead className="pl-6">MAC</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>Vers IP</TableHead>
                  <TableHead>Commentaire</TableHead>
                  <TableHead>Actif</TableHead>
                  <TableHead className="pr-6 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((b) => (
                  <TableRow key={b.id} className={b.disabled ? "opacity-60" : ""}>
                    <TableCell className="pl-6 font-mono text-xs text-gray-700">{b.macAddress || "—"}</TableCell>
                    <TableCell>{typeBadge(b.type)}</TableCell>
                    <TableCell className="font-mono text-xs text-gray-600">{b.address || "—"}</TableCell>
                    <TableCell className="font-mono text-xs text-gray-500">{b.toAddress || "—"}</TableCell>
                    <TableCell className="text-sm text-gray-600 max-w-[240px] truncate" title={b.comment}>
                      {b.comment || "—"}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={!b.disabled}
                        onCheckedChange={() => void toggleDisabled(b)}
                        aria-label={b.disabled ? "Activer" : "Désactiver"}
                      />
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-gray-500 hover:text-blue-600"
                          title="Modifier"
                          onClick={() => openEdit(b)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-gray-400 hover:text-red-600"
                          title="Supprimer"
                          onClick={() => setConfirmDelete(b)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Add / edit dialog */}
      <Dialog open={formOpen} onOpenChange={(o) => { if (!saving) setFormOpen(o); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Modifier la liaison" : "Nouveau bypass MAC"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Mettez à jour la liaison existante."
                : "Autorisez un appareil à contourner le portail captif en ajoutant son adresse MAC."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="mac">Adresse MAC</Label>
              <Input
                id="mac"
                value={form.macAddress}
                onChange={(e) => setForm((f) => ({ ...f, macAddress: e.target.value }))}
                placeholder="AA:BB:CC:DD:EE:FF"
                className="font-mono"
                autoFocus={!editing}
              />
              <p className="text-xs text-gray-400 mt-1">
                Format hexadécimal séparé par <code>:</code> ou <code>-</code>.
              </p>
            </div>
            <div>
              <Label htmlFor="addr">Adresse IP</Label>
              <Input
                id="addr"
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                placeholder="192.168.88.50"
                className="font-mono"
              />
            </div>
            <div>
              <Label htmlFor="toaddr">Vers adresse IP</Label>
              <Input
                id="toaddr"
                value={form.toAddress}
                onChange={(e) => setForm((f) => ({ ...f, toAddress: e.target.value }))}
                placeholder="10.0.0.50"
                className="font-mono"
              />
              <p className="text-xs text-gray-400 mt-1">
                Optionnel — utilisé pour une translation NAT 1 vers 1.
              </p>
            </div>
            <div>
              <Label htmlFor="server">Serveur</Label>
              <Input
                id="server"
                value={form.server}
                onChange={(e) => setForm((f) => ({ ...f, server: e.target.value }))}
                placeholder="all"
                className="font-mono"
              />
              <p className="text-xs text-gray-400 mt-1">
                Nom du serveur Hotspot (ex: <code>HOTSPOT_SERVER</code>) — laisser vide pour <code>all</code>.
              </p>
            </div>
            <div>
              <Label htmlFor="type">Type</Label>
              <Select value={form.type} onValueChange={(v: BindingType) => setForm((f) => ({ ...f, type: v }))}>
                <SelectTrigger id="type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bypassed">Bypass — accès direct sans portail</SelectItem>
                  <SelectItem value="blocked">Bloqué — interdit l&apos;accès</SelectItem>
                  <SelectItem value="regular">Standard — règle de NAT</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="comment">Commentaire</Label>
              <Input
                id="comment"
                value={form.comment}
                onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))}
                placeholder="Ex: TV salon, imprimante bureau…"
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">Désactivée</p>
                <p className="text-xs text-gray-500">La liaison existe mais n&apos;est pas appliquée.</p>
              </div>
              <Switch
                checked={form.disabled}
                onCheckedChange={(v) => setForm((f) => ({ ...f, disabled: v }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>Annuler</Button>
            <Button onClick={() => void submitForm()} disabled={saving}>
              {saving ? "Enregistrement…" : editing ? "Enregistrer" : "Ajouter"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => { if (!o && !deleting) setConfirmDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer la liaison ?</AlertDialogTitle>
            <AlertDialogDescription>
              La liaison{" "}
              <strong className="font-mono">
                {confirmDelete?.macAddress || confirmDelete?.address || ""}
              </strong>{" "}
              sera supprimée définitivement du routeur. L&apos;appareil devra à nouveau passer par le portail captif.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => void handleDelete()}
              disabled={deleting}
            >
              {deleting ? "Suppression…" : "Supprimer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
