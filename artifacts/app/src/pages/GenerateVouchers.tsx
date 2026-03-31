import { useState, useEffect } from "react";
import {
  useListRouters,
  useListRouterProfiles,
  useGenerateVouchers,
  useListVendors,
  getListVouchersQueryKey,
} from "@workspace/api-client-react";
import type { Voucher } from "@workspace/api-client-react";
import { useRouterContext } from "@/contexts/RouterContext";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Zap, Printer, Copy, Router as RouterIcon, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function makeBatchId(): string {
  const now = new Date();
  const Y = now.getFullYear();
  const M = String(now.getMonth() + 1).padStart(2, "0");
  const D = String(now.getDate()).padStart(2, "0");
  const H = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  return `LOT-${Y}${M}${D}-${H}${min}`;
}

export default function GenerateVouchers() {
  const { data: routers = [] } = useListRouters();
  const { data: vendors = [] } = useListVendors();
  const { selectedRouterId, setSelectedRouterId, selectedRouter } = useRouterContext();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [localRouterId, setLocalRouterId] = useState<string>(
    selectedRouterId ? String(selectedRouterId) : "",
  );
  const [profile, setProfile] = useState<string>("");
  const [qty, setQty] = useState("10");
  const [prefix, setPrefix] = useState("");
  const [comment, setComment] = useState(() => makeBatchId());
  const [vendorId, setVendorId] = useState<string>("");
  const [passwordMode, setPasswordMode] = useState<"same" | "random">("random");
  const [generatedVouchers, setGeneratedVouchers] = useState<Voucher[]>([]);

  const activeRouterId = selectedRouterId ?? (localRouterId ? parseInt(localRouterId, 10) : null);

  const { data: profiles = [], isLoading: loadingProfiles } = useListRouterProfiles(
    activeRouterId ?? 0,
    { query: { enabled: !!activeRouterId } },
  );

  const generateMutation = useGenerateVouchers();

  useEffect(() => {
    setProfile("");
  }, [activeRouterId]);

  useEffect(() => {
    if (selectedRouterId) setLocalRouterId(String(selectedRouterId));
  }, [selectedRouterId]);

  const selectedProfile = profiles.find((p) => p.name === profile);

  const handleLocalRouterChange = (val: string) => {
    setLocalRouterId(val);
    setSelectedRouterId(val ? parseInt(val, 10) : null);
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRouterId || !profile) return;

    const result = await generateMutation.mutateAsync({
      data: {
        routerId: activeRouterId,
        profile,
        qty: parseInt(qty, 10),
        prefix: prefix || null,
        comment: comment || null,
        vendorId: vendorId ? parseInt(vendorId, 10) : null,
        passwordMode,
      },
    });

    setGeneratedVouchers(result);
    queryClient.invalidateQueries({ queryKey: getListVouchersQueryKey() });
    toast({ title: `${result.length} voucher(s) généré(s) avec succès !` });
  };

  const handlePrint = () => {
    window.print();
  };

  const handleCopyAll = () => {
    const text = generatedVouchers
      .map((v) => `${v.username} / ${v.password}`)
      .join("\n");
    navigator.clipboard.writeText(text);
    toast({ title: "Codes copiés dans le presse-papier" });
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Générer des vouchers</h1>
        <p className="text-sm text-gray-500">Créez des comptes hotspot sur votre routeur MikroTik</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="h-4 w-4 text-blue-500" /> Paramètres de génération
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleGenerate} className="space-y-4">

              {selectedRouter ? (
                <div className="flex items-center gap-2 px-3 py-2.5 bg-blue-50 border border-blue-200 rounded-lg">
                  <RouterIcon className="h-4 w-4 text-blue-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-blue-900 truncate">{selectedRouter.name}</p>
                    <p className="text-xs text-blue-600">{selectedRouter.host}:{selectedRouter.port}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setSelectedRouterId(null); setLocalRouterId(""); }}
                    className="text-xs text-blue-400 hover:text-blue-600 whitespace-nowrap"
                  >
                    Changer
                  </button>
                </div>
              ) : (
                <div>
                  <Label>Routeur</Label>
                  <Select value={localRouterId} onValueChange={handleLocalRouterChange}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Sélectionnez un routeur" />
                    </SelectTrigger>
                    <SelectContent>
                      {routers.map((r) => (
                        <SelectItem key={r.id} value={String(r.id)}>
                          {r.name} — {r.host}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div>
                <Label>Profil</Label>
                <select
                  className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  value={profile}
                  onChange={(e) => setProfile(e.target.value)}
                  disabled={!activeRouterId || loadingProfiles}
                >
                  <option value="">{loadingProfiles ? "Chargement..." : "Sélectionnez un profil"}</option>
                  {profiles.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                      {p.validity ? ` · ${p.validity}` : ""}
                      {p.price ? ` · ${p.price}` : ""}
                    </option>
                  ))}
                </select>
                {selectedProfile && (
                  <div className="mt-2 p-2.5 bg-blue-50 rounded-lg text-xs text-blue-700 flex flex-wrap gap-2">
                    {selectedProfile.validity && (
                      <span>⏱ Durée: <strong>{selectedProfile.validity}</strong></span>
                    )}
                    {selectedProfile.price && (
                      <span>💰 Prix: <strong>{selectedProfile.price}</strong></span>
                    )}
                    {selectedProfile.rateLimit && (
                      <span>📶 Débit: <strong>{selectedProfile.rateLimit}</strong></span>
                    )}
                    {selectedProfile.lockMac && (
                      <span>🔒 Verrouillage MAC</span>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Quantité</Label>
                  <Input
                    className="mt-1"
                    type="number"
                    min={1}
                    max={200}
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <Label>Préfixe <span className="text-gray-400 text-xs">(optionnel)</span></Label>
                  <Input
                    className="mt-1"
                    placeholder="ex: vip-"
                    value={prefix}
                    onChange={(e) => setPrefix(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <Label className="mb-2 block">Mode du mot de passe</Label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPasswordMode("random")}
                    className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
                      passwordMode === "random"
                        ? "bg-blue-50 border-blue-400 text-blue-700"
                        : "border-gray-200 text-gray-500 hover:border-gray-300"
                    }`}
                  >
                    <span className="font-mono text-xs block mb-0.5">user &amp; password</span>
                    <span className="text-xs font-normal text-current opacity-70">Codes différents</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPasswordMode("same")}
                    className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
                      passwordMode === "same"
                        ? "bg-blue-50 border-blue-400 text-blue-700"
                        : "border-gray-200 text-gray-500 hover:border-gray-300"
                    }`}
                  >
                    <span className="font-mono text-xs block mb-0.5">user = password</span>
                    <span className="text-xs font-normal text-current opacity-70">Identiques</span>
                  </button>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label>Identifiant de lot</Label>
                  <button
                    type="button"
                    onClick={() => setComment(makeBatchId())}
                    className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1"
                    title="Générer un nouvel ID de lot"
                  >
                    <RefreshCw className="h-3 w-3" /> Régénérer
                  </button>
                </div>
                <Input
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="ex: LOT-20260101-0900"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Sert à regrouper ce lot pour l&apos;export ou la suppression groupée
                </p>
              </div>

              {vendors.length > 0 && (
                <div>
                  <Label>Vendeur <span className="text-gray-400 text-xs">(optionnel)</span></Label>
                  <Select value={vendorId || "none"} onValueChange={(v) => setVendorId(v === "none" ? "" : v)}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Aucun vendeur sélectionné" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— Aucun vendeur —</SelectItem>
                      {vendors.filter((v) => v.isActive).map((v) => (
                        <SelectItem key={v.id} value={String(v.id)}>
                          {v.name}{v.phone ? ` · ${v.phone}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <Button
                type="submit"
                className="w-full gap-2"
                disabled={!activeRouterId || !profile || generateMutation.isPending}
              >
                <Zap className="h-4 w-4" />
                {generateMutation.isPending ? "Génération en cours..." : `Générer ${qty} voucher(s)`}
              </Button>

              {generateMutation.isError && (
                <div className="text-sm text-red-500 bg-red-50 border border-red-200 rounded p-2">
                  Erreur : Impossible de contacter le routeur. Vérifiez les paramètres de connexion.
                </div>
              )}
            </form>
          </CardContent>
        </Card>

        <div>
          {generatedVouchers.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    {generatedVouchers.length} voucher(s) générés
                  </CardTitle>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={handleCopyAll} className="gap-1.5">
                      <Copy className="h-3.5 w-3.5" /> Copier
                    </Button>
                    <Button size="sm" variant="outline" onClick={handlePrint} className="gap-1.5">
                      <Printer className="h-3.5 w-3.5" /> Imprimer
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2 voucher-print-grid">
                  {generatedVouchers.map((v) => (
                    <div
                      key={v.id}
                      className="border-2 border-dashed border-blue-200 rounded-lg p-3 bg-blue-50 text-center"
                    >
                      <div className="text-xs text-gray-500 mb-1">{v.profileName}</div>
                      <div className="font-mono font-bold text-gray-900 text-sm">{v.username}</div>
                      <div className="font-mono text-gray-600 text-sm">/ {v.password}</div>
                      {v.validity && <div className="text-xs text-blue-600 mt-1">{v.validity}</div>}
                      {v.price && <Badge variant="outline" className="text-xs mt-1">{v.price}</Badge>}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
