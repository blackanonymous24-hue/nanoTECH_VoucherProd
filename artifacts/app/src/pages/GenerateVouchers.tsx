import { useState, useEffect } from "react";
import {
  useListRouters,
  useListRouterProfiles,
  useGenerateVouchers,
  getListVouchersQueryKey,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Voucher } from "@workspace/api-client-react";
import { useRouterContext } from "@/contexts/RouterContext";
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
import { Zap, Printer, Copy, Router as RouterIcon, RefreshCw, FileText, Table2, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { applyVars, getStoredTemplate } from "@/pages/TicketTemplate";

function makeBatchId(): string {
  const now = new Date();
  const M = String(now.getMonth() + 1).padStart(2, "0");
  const D = String(now.getDate()).padStart(2, "0");
  const Y = String(now.getFullYear()).slice(-2);
  const rand = String(Math.floor(Math.random() * 900) + 100);
  return `vc-${rand}-${M}.${D}.${Y}`;
}

export default function GenerateVouchers() {
  const { data: routers = [] } = useListRouters();
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
  const [passwordMode, setPasswordMode] = useState<"same" | "random">("same");
  const [generatedVouchers, setGeneratedVouchers] = useState<Voucher[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const activeRouterId = selectedRouterId ?? (localRouterId ? parseInt(localRouterId, 10) : null);

  const GEN_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
  const { data: vendors = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["vendors", activeRouterId],
    queryFn: async () => {
      const url = activeRouterId
        ? `${GEN_BASE}/api/vendors?routerId=${activeRouterId}`
        : `${GEN_BASE}/api/vendors`;
      const res = await fetch(url);
      if (!res.ok) return [];
      return res.json() as Promise<{ id: number; name: string }[]>;
    },
    staleTime: 60_000,
  });

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

  const BATCH_SIZE = 50;

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRouterId || !profile) return;

    const total = parseInt(qty, 10);
    const allVouchers: Voucher[] = [];
    let done = 0;
    setProgress({ done: 0, total });

    try {
      while (done < total) {
        const batchQty = Math.min(BATCH_SIZE, total - done);
        const batch = await generateMutation.mutateAsync({
          data: {
            routerId: activeRouterId,
            profile,
            qty: batchQty,
            prefix: prefix || null,
            comment: comment || null,
            vendorId: vendorId ? parseInt(vendorId, 10) : null,
            passwordMode,
          },
        });
        allVouchers.push(...batch);
        done += batch.length;
        setProgress({ done, total });
      }

      setGeneratedVouchers(allVouchers);
      queryClient.invalidateQueries({ queryKey: getListVouchersQueryKey() });
      toast({ title: `${allVouchers.length} voucher(s) généré(s) avec succès !` });
    } finally {
      setProgress(null);
    }
  };

  const handlePrint = () => window.print();

  const handleCopyAll = () => {
    const text = generatedVouchers
      .map((v) => `${v.username} / ${v.password}`)
      .join("\n");
    navigator.clipboard.writeText(text);
    toast({ title: "Codes copiés dans le presse-papier" });
  };

  const downloadFile = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportTxt = () => {
    const lines = generatedVouchers.map((v, i) =>
      `${i + 1}. ${v.username}${v.username !== v.password ? ` / ${v.password}` : ""}${v.validity ? ` [${v.validity}]` : ""}${v.price ? ` - ${v.price} FCFA` : ""}`
    );
    downloadFile(`Lot: ${comment}\n\n${lines.join("\n")}`, `${comment}.txt`, "text/plain");
  };

  const handleExportCsv = () => {
    const header = "N°,Username,Password,Profil,Validité,Prix\n";
    const rows = generatedVouchers.map((v, i) =>
      `${i + 1},"${v.username}","${v.password}","${v.profileName ?? ""}","${v.validity ?? ""}","${v.price ?? ""}"`
    ).join("\n");
    downloadFile(header + rows, `${comment}.csv`, "text/csv");
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
                    max={5000}
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
                <Label className="mb-2 block">Mode de connexion</Label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPasswordMode("same")}
                    className={`flex-1 py-2 px-4 rounded-lg border text-sm font-medium transition-colors ${
                      passwordMode === "same"
                        ? "bg-blue-50 border-blue-400 text-blue-700"
                        : "border-gray-200 text-gray-500 hover:border-gray-300"
                    }`}
                  >
                    <span className="font-semibold block mb-0.5">Mode Voucher</span>
                    <span className="text-xs font-normal block">Code unique (user = password)</span>
                    <span className="text-xs font-normal opacity-60">✓ Portail captif &quot;Session Voucher&quot;</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPasswordMode("random")}
                    className={`flex-1 py-2 px-4 rounded-lg border text-sm font-medium transition-colors ${
                      passwordMode === "random"
                        ? "bg-blue-50 border-blue-400 text-blue-700"
                        : "border-gray-200 text-gray-500 hover:border-gray-300"
                    }`}
                  >
                    <span className="font-semibold block mb-0.5">Mode Compte</span>
                    <span className="text-xs font-normal block">Identifiants séparés</span>
                    <span className="text-xs font-normal opacity-60">→ Portail captif &quot;Session Compte&quot;</span>
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

              <div>
                <Button
                  type="submit"
                  className="w-full gap-2"
                  disabled={!activeRouterId || !profile || !!progress}
                >
                  <Zap className="h-4 w-4" />
                  {progress ? "Génération en cours..." : `Générer ${qty} voucher(s)`}
                </Button>
                {progress && (
                  <div className="flex items-center justify-end gap-2 mt-1.5">
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-orange-500 rounded-full transition-all duration-300"
                        style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 tabular-nums whitespace-nowrap">
                      {progress.done} / {progress.total}
                    </span>
                  </div>
                )}
              </div>

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
            <Card className="overflow-hidden">
              {/* ── Lot header — styled like Tous les lots ── */}
              <div className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-3 min-w-0">
                  <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="font-mono font-semibold text-gray-900 text-sm break-all">{comment}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-0.5">
                      <span className="text-xs text-green-600 font-medium">
                        {generatedVouchers.length} voucher(s) générés
                      </span>
                      {generatedVouchers[0]?.profileName && (
                        <>
                          <span className="text-gray-300">·</span>
                          <span className="text-xs text-gray-400">{generatedVouchers[0].profileName}</span>
                        </>
                      )}
                      {generatedVouchers[0]?.price && (
                        <>
                          <span className="text-gray-300">·</span>
                          <span className="text-xs text-gray-400">{generatedVouchers[0].price} FCFA</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                  <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={handleExportTxt} title="Exporter en .txt">
                    <FileText className="h-3.5 w-3.5" /> .txt
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={handleExportCsv} title="Exporter en .csv">
                    <Table2 className="h-3.5 w-3.5" /> .csv
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={handleCopyAll} title="Copier tous les codes">
                    <Copy className="h-3.5 w-3.5" /> Copier
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={handlePrint} title="Imprimer les tickets">
                    <Printer className="h-3.5 w-3.5" /> Imprimer
                  </Button>
                </div>
              </div>

              {/* ── Compact codes list ── */}
              <div className="border-t border-gray-100 max-h-80 overflow-y-auto">
                <div className="divide-y divide-gray-50">
                  {generatedVouchers.map((v, i) => (
                    <div key={v.id} className="flex items-center gap-3 px-5 py-2">
                      <span className="text-xs text-gray-300 w-6 text-right flex-shrink-0 tabular-nums">{i + 1}</span>
                      <code className="font-mono text-sm font-semibold text-gray-900 flex-1">{v.username}</code>
                      {v.username !== v.password && (
                        <code className="font-mono text-xs text-gray-400 flex-shrink-0">{v.password}</code>
                      )}
                      {v.validity && (
                        <span className="text-xs text-blue-500 flex-shrink-0">{v.validity}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* ── Print section — uses global @media print CSS ── */}
      <div id="voucher-print-section" style={{ display: "none" }}>
        {generatedVouchers.map((v, idx) => {
          const PRICE_COLORS: Record<string, string> = {
            "0":"#E50877","100":"#752CEB","200":"#804000","300":"#13C013","500":"#ECA352",
            "1000":"#F75418","1500":"#FF69B4","2500":"#F70000","3000":"#F70000",
            "13000":"#2E8B57","15000":"#2E8B57","17000":"#0000FF","20000":"#0000FF",
            "35000":"#6495ED","40000":"#6495ED","80000":"#FF8C00","85000":"#FF8C00",
            "160000":"#DC143C","170000":"#DC143C",
          };
          const color = PRICE_COLORS[String(v.price ?? "")] ?? "#1433FD";
          const rawV = v.validity ?? "";
          const vl = rawV.slice(-1), vn = rawV.slice(0, -1);
          const validity = vl === "d" ? `Validité : ${vn} Jour(s)` : vl === "h" ? `Validité : ${vn} Heure(s)` : vl === "w" ? `Validité : ${vn} Semaine(s)` : rawV;
          const isVC = v.username === v.password;
          const codeblock = isVC
            ? `<div style="padding:0px;border-bottom:1px solid;text-align:center;font-weight:bold;font-size:9px;color:#444;">Code Ticket</div><div style="padding:0px;border-bottom:1px solid;text-align:center;font-weight:bold;font-size:12px;color:${color};">${v.username}</div>`
            : `<div style="padding:0px;border-bottom:1px solid;text-align:center;font-weight:bold;font-size:10px;color:#444;">Compte Utilisateur</div><div style="padding:0px;border-bottom:1px solid;text-align:center;font-weight:bold;font-size:12px;color:${color};">User: ${v.username}<br>Pass: ${v.password}</div>`;
          const qrData = isVC ? v.username : `${v.username}:${v.password}`;
          const qrcode = `https://api.qrserver.com/v1/create-qr-code/?size=60x60&data=${encodeURIComponent(qrData)}&margin=2`;
          const tpl = getStoredTemplate();
          const vars: Record<string, string> = {
            hotspotname: selectedRouter?.name ?? "",
            dnsname: (selectedRouter as any)?.contact ?? "",
            username: v.username,
            password: v.password,
            price: String(v.price ?? ""),
            currency: "FCFA",
            validity,
            timelimit: "",
            datalimit: "",
            num: String(idx + 1),
            profile: v.profileName ?? "",
            color,
            codeblock,
            qrcode,
          };
          return <div key={v.id} dangerouslySetInnerHTML={{ __html: applyVars(tpl, vars) }} />;
        })}
      </div>
    </div>
  );
}
