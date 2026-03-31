import { useState } from "react";
import { useListRouters, useListRouterProfiles } from "@workspace/api-client-react";
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
import { PackageOpen, Clock, Banknote, Users, Wifi, Lock, Plus } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

function formatValidity(v: string | null | undefined): string {
  if (!v) return "Illimité";
  return v
    .replace(/(\d+)h/, "$1 heure(s)")
    .replace(/(\d+)d/, "$1 jour(s)")
    .replace(/(\d+)w/, "$1 semaine(s)");
}

const VALIDITY_PRESETS = [
  { label: "30 minutes", value: "30m" },
  { label: "1 heure", value: "1h" },
  { label: "2 heures", value: "2h" },
  { label: "3 heures", value: "3h" },
  { label: "6 heures", value: "6h" },
  { label: "12 heures", value: "12h" },
  { label: "1 jour", value: "1d" },
  { label: "2 jours", value: "2d" },
  { label: "3 jours", value: "3d" },
  { label: "7 jours", value: "7d" },
  { label: "15 jours", value: "15d" },
  { label: "30 jours", value: "30d" },
];

const defaultForm = {
  name: "",
  label: "",
  price: "",
  validity: "",
  sharedUsers: "1",
  addrPool: "",
  rateLimit: "",
  lockMac: false,
};

export default function Forfaits() {
  const { data: routers = [], isLoading: loadingRouters } = useListRouters();
  const [routerId, setRouterId] = useState<string>("");
  const queryClient = useQueryClient();

  const { data: profiles = [], isLoading: loadingProfiles } = useListRouterProfiles(
    parseInt(routerId, 10),
    { query: { enabled: !!routerId } },
  );

  const [showDialog, setShowDialog] = useState(false);
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pools, setPools] = useState<string[]>([]);
  const [loadingPools, setLoadingPools] = useState(false);

  function setField<K extends keyof typeof defaultForm>(key: K, val: (typeof defaultForm)[K]) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  async function handleCreate() {
    setError(null);
    if (!routerId) { setError("Sélectionnez un routeur d'abord."); return; }
    if (!form.name.trim() || !form.label.trim() || !form.price.trim() || !form.validity.trim()) {
      setError("Nom, code, prix et validité sont obligatoires."); return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/routers/${routerId}/profiles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Erreur lors de la création"); setSaving(false); return; }
      setShowDialog(false);
      setForm(defaultForm);
      queryClient.invalidateQueries({ queryKey: ["listRouterProfiles", parseInt(routerId, 10)] });
    } catch {
      setError("Impossible de contacter le serveur.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Forfaits</h1>
          <p className="text-sm text-gray-500">Profils hotspot disponibles sur vos routeurs MikroTik</p>
        </div>
        <Button
          onClick={async () => {
            setError(null);
            setForm(defaultForm);
            setPools([]);
            setShowDialog(true);
            if (routerId) {
              setLoadingPools(true);
              try {
                const res = await fetch(`/api/routers/${routerId}/pools`);
                if (res.ok) setPools(await res.json());
              } catch { /* ignore */ } finally {
                setLoadingPools(false);
              }
            }
          }}
          disabled={!routerId}
          className="flex-shrink-0"
        >
          <Plus className="h-4 w-4 mr-1.5" /> Ajouter un forfait
        </Button>
      </div>

      <div className="mb-6 max-w-xs">
        <Select value={routerId} onValueChange={setRouterId} disabled={loadingRouters}>
          <SelectTrigger>
            <SelectValue placeholder="Sélectionnez un routeur" />
          </SelectTrigger>
          <SelectContent>
            {routers.map((r) => (
              <SelectItem key={r.id} value={String(r.id)}>
                {r.name} — {r.host}:{r.port}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!routerId && (
        <Card>
          <CardContent className="py-16 text-center">
            <PackageOpen className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">Sélectionnez un routeur</p>
            <p className="text-sm text-gray-400 mt-1">Les forfaits disponibles s&apos;afficheront ici</p>
          </CardContent>
        </Card>
      )}

      {routerId && loadingProfiles && (
        <div className="text-sm text-gray-400">Chargement des forfaits...</div>
      )}

      {routerId && !loadingProfiles && profiles.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-gray-500">Aucun profil trouvé sur ce routeur.</p>
          </CardContent>
        </Card>
      )}

      {profiles.length > 0 && (
        <>
          <p className="text-sm text-gray-500 mb-4">{profiles.length} forfait(s) trouvé(s)</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {profiles.map((p) => (
              <Card key={p.name} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-base font-bold text-gray-900 truncate" title={p.name}>
                    {p.name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                    <span className="text-gray-700">{formatValidity(p.validity)}</span>
                  </div>

                  {p.price && p.price !== "0" ? (
                    <div className="flex items-center gap-2 text-sm">
                      <Banknote className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                      <span className="text-gray-700 font-semibold">{p.price} FCFA</span>
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
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Ajouter un forfait</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2 space-y-1.5">
              <Label>Nom du profil <span className="text-red-500">*</span></Label>
              <Input
                placeholder="ex: 3-Heure"
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Code court <span className="text-red-500">*</span></Label>
              <Input
                placeholder="ex: remc"
                value={form.label}
                onChange={(e) => setField("label", e.target.value)}
              />
              <p className="text-xs text-gray-400">Identifiant court utilisé dans les logs</p>
            </div>

            <div className="space-y-1.5">
              <Label>Prix (FCFA) <span className="text-red-500">*</span></Label>
              <Input
                placeholder="ex: 100"
                type="number"
                min="0"
                value={form.price}
                onChange={(e) => setField("price", e.target.value)}
              />
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label>Validité <span className="text-red-500">*</span></Label>
              <Select value={form.validity} onValueChange={(v) => setField("validity", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Choisir une durée…" />
                </SelectTrigger>
                <SelectContent>
                  {VALIDITY_PRESETS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Appareils simultanés</Label>
              <Input
                placeholder="1"
                type="number"
                min="1"
                value={form.sharedUsers}
                onChange={(e) => setField("sharedUsers", e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Débit max</Label>
              <Input
                placeholder="ex: 1M/1M"
                value={form.rateLimit}
                onChange={(e) => setField("rateLimit", e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
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

            <div className="flex items-center gap-3 pt-2">
              <Switch
                id="lockMac"
                checked={form.lockMac}
                onCheckedChange={(v) => setField("lockMac", v)}
              />
              <Label htmlFor="lockMac" className="cursor-pointer">
                <Lock className="h-3.5 w-3.5 inline mr-1 text-amber-500" />
                Verrouillage MAC
              </Label>
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)} disabled={saving}>
              Annuler
            </Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? "Création…" : "Créer le forfait"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
