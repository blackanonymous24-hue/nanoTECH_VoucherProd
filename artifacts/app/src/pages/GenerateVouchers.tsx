import { useState, useEffect } from "react";
import {
  useListRouters,
  useListRouterProfiles,
  useGenerateVouchers,
  getListVouchersQueryKey,
} from "@workspace/api-client-react";
import type { Voucher } from "@workspace/api-client-react";
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
import { Zap, Printer, Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function GenerateVouchers() {
  const { data: routers = [] } = useListRouters();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [routerId, setRouterId] = useState<string>("");
  const [profile, setProfile] = useState<string>("");
  const [qty, setQty] = useState("10");
  const [prefix, setPrefix] = useState("");
  const [comment, setComment] = useState("");
  const [generatedVouchers, setGeneratedVouchers] = useState<Voucher[]>([]);

  const { data: profiles = [], isLoading: loadingProfiles } = useListRouterProfiles(
    parseInt(routerId, 10),
    { query: { enabled: !!routerId } },
  );

  const generateMutation = useGenerateVouchers();

  useEffect(() => {
    setProfile("");
  }, [routerId]);

  const selectedProfile = profiles.find((p) => p.name === profile);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!routerId || !profile) return;

    const result = await generateMutation.mutateAsync({
      data: {
        routerId: parseInt(routerId, 10),
        profile,
        qty: parseInt(qty, 10),
        prefix: prefix || null,
        comment: comment || null,
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
              <div>
                <Label>Routeur</Label>
                <Select value={routerId} onValueChange={setRouterId}>
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

              <div>
                <Label>Profil</Label>
                <Select value={profile} onValueChange={setProfile} disabled={!routerId || loadingProfiles}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder={loadingProfiles ? "Chargement..." : "Sélectionnez un profil"} />
                  </SelectTrigger>
                  <SelectContent>
                    {profiles.map((p) => (
                      <SelectItem key={p.name} value={p.name}>
                        {p.name}
                        {p.validity && ` · ${p.validity}`}
                        {p.price && ` · ${p.price}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                <Label>Commentaire <span className="text-gray-400 text-xs">(optionnel)</span></Label>
                <Input
                  className="mt-1"
                  placeholder="ex: Vente du 01/06"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
              </div>

              <Button
                type="submit"
                className="w-full gap-2"
                disabled={!routerId || !profile || generateMutation.isPending}
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
