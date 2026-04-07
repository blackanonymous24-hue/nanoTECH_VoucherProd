import { useState, useEffect } from "react";
import {
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Zap, Printer, Copy, Router as RouterIcon, RefreshCw, FileText, Table2, CheckCircle2, Check, ChevronsUpDown, Clock, Package } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getStoredPHP } from "@/pages/TicketTemplate";

const LS_KEY = "vouchernet-last-lot";

type LastLot = {
  vouchers: Voucher[];
  comment: string;
  routerName: string;
  routerId: number;
  profileName: string;
  price: string;
  validity: string;
  vendorName: string;
  generatedAt: string;
};

function loadLastLot(): LastLot | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as LastLot) : null;
  } catch {
    return null;
  }
}

function saveLastLot(lot: LastLot) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(lot)); } catch { /* noop */ }
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** "3h"→"3H", "1d"→"1J", "30m"→"30M", "1w"→"1S" */
function validityCode(validity: string | null | undefined): string {
  if (!validity) return "";
  const m = validity.trim().match(/^(\d+)([a-zA-Z]+)$/);
  if (!m) return "";
  const map: Record<string, string> = { h: "H", d: "J", m: "M", w: "S" };
  return m[1] + (map[m[2].toLowerCase()] ?? m[2].toUpperCase());
}

type CharType = "lower" | "upper" | "upplow" | "mix" | "mix1" | "mix2" | "num";

const CHAR_TYPE_DESCS: Record<CharType, string> = {
  lower:  "minuscules",
  upper:  "majuscules",
  upplow: "mixte lettres",
  mix:    "minusc. + chiffres",
  mix1:   "majusc. + chiffres",
  mix2:   "mixte + chiffres",
  num:    "chiffres uniquement",
};

const CHAR_TYPE_PREVIEW: Record<CharType, string> = {
  lower:  "abcdefgh",
  upper:  "ABCDEFGH",
  upplow: "aBcDeFgH",
  mix:    "5ab2c34d",
  mix1:   "5AB2C34D",
  mix2:   "5aB2c34D",
  num:    "12345678",
};

const CHAR_TYPE_ORDER: CharType[] = ["mix", "mix1", "mix2"];

function makeBatchId(mode: "vc" | "up" = "vc"): string {
  const now = new Date();
  const M = String(now.getMonth() + 1).padStart(2, "0");
  const D = String(now.getDate()).padStart(2, "0");
  const Y = String(now.getFullYear()).slice(-2);
  const rand = String(Math.floor(Math.random() * 900) + 100);
  return `${mode}-${rand}-${M}.${D}.${Y}`;
}

export default function GenerateVouchers() {
  const { selectedRouterId, selectedRouter } = useRouterContext();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [profile, setProfile] = useState<string>("");
  const [qty, setQty] = useState("10");
  const [prefix, setPrefix] = useState("");
  const [passwordMode, setPasswordMode] = useState<"same" | "random">("same");
  const [charType, setCharType] = useState<CharType>("mix");
  const [userLength, setUserLength] = useState("5");
  const [timelimit, setTimelimit] = useState("");
  const [datalimit, setDatalimit] = useState("");
  const [mbgb, setMbgb] = useState<number>(1048576);
  const [comment, setComment] = useState(() => makeBatchId("vc"));
  const [vendorId, setVendorId] = useState<string>("");
  const [lastLot, setLastLot] = useState<LastLot | null>(() => loadLastLot());
  const [loadingLastLot, setLoadingLastLot] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [profilePopoverOpen, setProfilePopoverOpen] = useState(false);
  const [vendorPopoverOpen, setVendorPopoverOpen] = useState(false);
  const autoLoadAttempted = useState(() => new Set<number>())[0];

  // Auto-select length 5 when a mix format is chosen in Mode Voucher
  useEffect(() => {
    if (passwordMode === "same" && (charType === "mix" || charType === "mix1" || charType === "mix2")) {
      setUserLength("5");
    }
  }, [charType, passwordMode]);

  const GEN_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
  const { data: vendors = [] } = useQuery<{ id: number; name: string; isActive?: boolean; phone?: string | null }[]>({
    queryKey: ["vendors", selectedRouterId],
    queryFn: async ({ signal }) => {
      const url = selectedRouterId
        ? `${GEN_BASE}/api/vendors?routerId=${selectedRouterId}`
        : `${GEN_BASE}/api/vendors`;
      const res = await fetch(url, { signal });
      if (!res.ok) return [];
      return res.json() as Promise<{ id: number; name: string }[]>;
    },
    staleTime: 60_000,
  });

  const { data: profiles = [], isLoading: loadingProfiles } = useListRouterProfiles(
    selectedRouterId ?? 0,
    { query: { enabled: !!selectedRouterId } },
  );

  const generateMutation = useGenerateVouchers();

  useEffect(() => {
    setProfile("");
  }, [selectedRouterId]);

  // On page load (Generate tab), force a MikroTik profile sync once per router
  // so both Generate and Forfaits use fresh profile metadata.
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
        // Keep existing cached profiles if live sync fails.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedRouterId, queryClient]);

  // Auto-load the most recent lot from API when localStorage is empty
  useEffect(() => {
    if (lastLot !== null) return;
    if (!selectedRouterId) return;
    if (autoLoadAttempted.has(selectedRouterId)) return;
    autoLoadAttempted.add(selectedRouterId);

    const controller = new AbortController();
    setLoadingLastLot(true);

    void (async () => {
      try {
        const lotsRes = await fetch(
          `${GEN_BASE}/api/routers/${selectedRouterId}/lots`,
          { signal: controller.signal },
        );
        if (!lotsRes.ok) return;
        const { lots: apiLots } = await lotsRes.json() as {
          lots: Array<{ name: string; count: number; profile: string | null }>;
        };
        if (!apiLots.length) return;

        const firstLot = apiLots[0];

        const usersRes = await fetch(
          `${GEN_BASE}/api/routers/${selectedRouterId}/users?comment=${encodeURIComponent(firstLot.name)}&limit=5000`,
          { signal: controller.signal },
        );
        if (!usersRes.ok) return;
        const { users } = await usersRes.json() as { users: Array<{ username: string; password: string; profile: string }> };
        if (!users.length) return;

        // Cross-reference profile metadata (prices/validity) from already-loaded profiles
        const prof = profiles.find((p) => p.name === firstLot.profile);

        const lot: LastLot = {
          vouchers: users.map((u, i) => ({
            id: i,
            routerId: selectedRouterId,
            username: u.username,
            password: u.password,
            profileName: u.profile ?? firstLot.profile ?? "",
            price: prof?.price ?? "",
            validity: prof?.validity ?? "",
            createdAt: new Date().toISOString(),
          })),
          comment: firstLot.name,
          routerName: selectedRouter?.name ?? "",
          routerId: selectedRouterId,
          profileName: firstLot.profile ?? "",
          price: prof?.price ?? "",
          validity: prof?.validity ?? "",
          vendorName: "",
          generatedAt: new Date().toISOString(),
        };

        setLastLot(lot);
        saveLastLot(lot);
      } catch {
        // Router offline or aborted — keep "Aucun lot" state, user can generate
      } finally {
        setLoadingLastLot(false);
      }
    })();

    return () => controller.abort();
  }, [selectedRouterId, lastLot, profiles, selectedRouter, autoLoadAttempted]);

  const selectedProfile = profiles.find((p) => p.name === profile);

  const selectedVendor = vendors.find((v) => String(v.id) === vendorId);
  const vendorSuffix =
    selectedVendor && selectedProfile?.validity
      ? `-${validityCode(selectedProfile.validity)}${selectedVendor.name.toUpperCase()}`
      : selectedVendor
      ? `-${selectedVendor.name.toUpperCase()}`
      : "";
  const effectiveComment = comment + vendorSuffix;

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRouterId || !profile) return;

    const total = parseInt(qty, 10);
    setProgress({ done: 0, total });

    const dlBytes = datalimit ? Math.round(parseFloat(datalimit) * mbgb) : undefined;
    const profilePrice = selectedProfile?.price ?? "";
    const profileValidity = selectedProfile?.validity ?? "";
    const BATCH_SIZE = total >= 600 ? 200 : total >= 250 ? 120 : 80;
    const allVouchers: Voucher[] = [];
    let done = 0;

    try {
      while (done < total) {
        const qtyBatch = Math.min(BATCH_SIZE, total - done);
        const generated = await generateMutation.mutateAsync({
          data: {
            routerId: selectedRouterId,
            profile,
            qty: qtyBatch,
            prefix: prefix || null,
            comment: effectiveComment || null,
            vendorId: vendorId ? parseInt(vendorId, 10) : null,
            passwordMode,
            charType,
            userLength: parseInt(userLength, 10),
            timelimit: timelimit || undefined,
            datalimit: dlBytes,
            profilePrice,
            profileValidity,
          },
        });
        allVouchers.push(...generated);
        done += generated.length;
        setProgress({ done, total });
      }

      const lot: LastLot = {
        vouchers: allVouchers,
        comment: effectiveComment,
        routerName: selectedRouter?.name ?? "",
        routerId: selectedRouterId,
        profileName: selectedProfile?.name ?? profile,
        price: selectedProfile?.price ?? "",
        validity: selectedProfile?.validity ?? "",
        vendorName: selectedVendor?.name ?? "",
        generatedAt: new Date().toISOString(),
      };
      setLastLot(lot);
      saveLastLot(lot);
      queryClient.invalidateQueries({ queryKey: getListVouchersQueryKey() });
      toast({ title: `${allVouchers.length} voucher(s) généré(s) avec succès !` });
    } finally {
      setProgress(null);
    }
  };

  const handlePrint = async (lot: LastLot) => {
    const php = getStoredPHP()!;
    const PRICE_COLORS: Record<string, string> = {
      "0":"#E50877","100":"#752CEB","200":"#804000","300":"#13C013","500":"#ECA352",
      "1000":"#F75418","1500":"#FF69B4","2500":"#F70000","3000":"#F70000",
    };
    const vouchers = lot.vouchers.map((v, idx) => ({
      hotspotname: lot.routerName,
      dnsname: (selectedRouter as any)?.contact ?? "",
      username: v.username,
      password: v.password,
      price: String(v.price ?? ""),
      currency: "FCFA",
      validity: v.validity ?? "",
      timelimit: "",
      datalimit: "",
      num: idx + 1,
      color: PRICE_COLORS[String(v.price ?? "")] ?? "#1433FD",
    }));
    try {
      const resp = await fetch(`${BASE}/api/render-tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ php, vouchers }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      const win = window.open("", "_blank", "noopener,noreferrer");
      if (!win) throw new Error("Le navigateur a bloqué l'ouverture du nouvel onglet.");
      const content = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Voucher-${lot.routerName}</title>
    <style>
      body { color:#000; background:#fff; font-size:14px; font-family:Helvetica, Arial, sans-serif; margin:0; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
      table.voucher { display:inline-block; border:2px solid black; margin:2px; }
      #num { float:right; display:inline-block; }
      @page { size:auto; margin-left:7mm; margin-right:3mm; margin-top:9mm; margin-bottom:3mm; }
      @media print {
        table { page-break-after:auto; }
        tr { page-break-inside:avoid; page-break-after:auto; }
        td { page-break-inside:avoid; page-break-after:auto; }
        thead { display:table-header-group; }
        tfoot { display:table-footer-group; }
      }
    </style>
  </head>
  <body>
    ${(data.html as string[]).join("")}
    <script>
      window.addEventListener("load", function () {
        setTimeout(function () { window.print(); }, 60);
      });
    </script>
  </body>
</html>`;
      win.document.open();
      win.document.write(content);
      win.document.close();
    } catch (err: unknown) {
      toast({ title: "Erreur impression PHP", description: String(err), variant: "destructive" });
    }
  };

  const downloadFile = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyAll = (lot: LastLot) => {
    const text = lot.vouchers.map((v) => `${v.username} / ${v.password}`).join("\n");
    navigator.clipboard.writeText(text);
    toast({ title: "Codes copiés dans le presse-papier" });
  };

  const handleExportTxt = (lot: LastLot) => {
    const lines = lot.vouchers.map((v, i) =>
      `${i + 1}. ${v.username}${v.username !== v.password ? ` / ${v.password}` : ""}${v.validity ? ` [${v.validity}]` : ""}${v.price ? ` - ${v.price} FCFA` : ""}`
    );
    downloadFile(`Lot: ${lot.comment}\n\n${lines.join("\n")}`, `${lot.comment}.txt`, "text/plain");
  };

  const handleExportCsv = (lot: LastLot) => {
    const header = "N°,Username,Password,Profil,Validité,Prix\n";
    const rows = lot.vouchers.map((v, i) =>
      `${i + 1},"${v.username}","${v.password}","${v.profileName ?? ""}","${v.validity ?? ""}","${v.price ?? ""}"`
    ).join("\n");
    downloadFile(header + rows, `${lot.comment}.csv`, "text/csv");
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
            <form onSubmit={handleGenerate} className="form-shell space-y-4">

              {selectedRouter ? (
                <div className="flex items-center gap-2 px-3 py-2.5 bg-blue-50 border border-blue-200 rounded-lg">
                  <RouterIcon className="h-4 w-4 text-blue-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-blue-900 truncate">{selectedRouter.name}</p>
                    <p className="text-xs text-blue-600">{selectedRouter.host}:{selectedRouter.port}</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 text-amber-700 px-4 py-3 rounded-lg text-sm">
                  <RouterIcon className="h-4 w-4 flex-shrink-0" />
                  Sélectionnez un routeur dans la barre latérale pour commencer
                </div>
              )}

              <div>
                <Label>Profil</Label>
                <Popover open={profilePopoverOpen} onOpenChange={setProfilePopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={profilePopoverOpen}
                      disabled={!selectedRouterId || loadingProfiles}
                      className="w-full mt-1 justify-between font-normal"
                    >
                      <span className="truncate">
                        {loadingProfiles
                          ? "Chargement..."
                          : profile
                            ? (profiles.find((p) => p.name === profile)?.name ?? profile)
                            : "Sélectionner un profil"}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                    <Command shouldFilter={false}>
                      <CommandList className="max-h-52 overflow-y-auto">
                        <CommandEmpty>Aucun profil disponible.</CommandEmpty>
                        <CommandGroup>
                          {profiles.map((p) => (
                            <CommandItem
                              key={p.name}
                              value={p.name}
                              onSelect={() => { setProfile(p.name); setProfilePopoverOpen(false); }}
                            >
                              <Check className={`mr-2 h-4 w-4 ${profile === p.name ? "opacity-100" : "opacity-0"}`} />
                              <span className="flex-1">{p.name}</span>
                              {(p.validity || p.price) && (
                                <span className="text-xs text-gray-400 ml-2">
                                  {[p.validity, p.price].filter(Boolean).join(" · ")}
                                </span>
                              )}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => { setPasswordMode("same"); setComment(makeBatchId("vc")); }}
                    className={`py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
                      passwordMode === "same"
                        ? "bg-blue-50 border-blue-400 text-blue-700"
                        : "border-gray-200 text-gray-500 hover:border-gray-300"
                    }`}
                  >
                    <span className="font-semibold block mb-0.5">Mode Voucher</span>
                    <span className="text-xs font-normal block">Code unique (user = pass)</span>
                    <span className="text-xs font-normal opacity-60 font-mono">vc-xxx-dd.mm.yy</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPasswordMode("random"); setComment(makeBatchId("up")); }}
                    className={`py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
                      passwordMode === "random"
                        ? "bg-blue-50 border-blue-400 text-blue-700"
                        : "border-gray-200 text-gray-500 hover:border-gray-300"
                    }`}
                  >
                    <span className="font-semibold block mb-0.5">Mode Compte</span>
                    <span className="text-xs font-normal block">Identifiants séparés</span>
                    <span className="text-xs font-normal opacity-60 font-mono">up-xxx-dd.mm.yy</span>
                  </button>
                </div>
              </div>

              {/* ─ Format + Longueur ─ */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>Format</Label>
                  <select
                    className="mt-1 w-full h-9 border border-input bg-background rounded-md px-3 text-sm font-mono"
                    value={charType}
                    onChange={(e) => setCharType(e.target.value as CharType)}
                  >
                    {CHAR_TYPE_ORDER.map((type) => {
                      const len = parseInt(userLength, 10);
                      const p = CHAR_TYPE_PREVIEW[type];
                      const ex = p.repeat(Math.ceil(len / p.length)).slice(0, len);
                      return (
                        <option key={type} value={type}>
                          {ex}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div>
                  <Label>Longueur</Label>
                  <select
                    className="mt-1 w-full h-9 border border-input bg-background rounded-md px-3 text-sm font-mono"
                    value={userLength}
                    onChange={(e) => setUserLength(e.target.value)}
                  >
                    {[3,4,5,6,7,8].map((n) => (
                      <option key={n} value={String(n)}>{n} caractères</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* ─ Limites facultatives ─ */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>Limite de temps <span className="text-gray-400 text-xs">(optionnel)</span></Label>
                  <Input
                    className="mt-1 font-mono"
                    placeholder="ex: 1h, 30m"
                    value={timelimit}
                    onChange={(e) => setTimelimit(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Limite de données <span className="text-gray-400 text-xs">(optionnel)</span></Label>
                  <div className="flex gap-1 mt-1">
                    <Input
                      type="number"
                      min={0}
                      placeholder="0"
                      value={datalimit}
                      onChange={(e) => setDatalimit(e.target.value)}
                    />
                    <select
                      className="border border-input bg-background rounded-md px-2 text-sm"
                      value={mbgb}
                      onChange={(e) => setMbgb(Number(e.target.value))}
                    >
                      <option value={1048576}>MB</option>
                      <option value={1073741824}>GB</option>
                    </select>
                  </div>
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
                {vendorSuffix && (
                  <p className="text-xs mt-1 font-mono">
                    <span className="text-gray-400">ID final : </span>
                    <span className="text-gray-600">{comment}</span>
                    <span className="text-blue-600 font-semibold">{vendorSuffix}</span>
                  </p>
                )}
                {!vendorSuffix && (
                  <p className="text-xs text-gray-400 mt-1">
                    Sert à regrouper ce lot pour l&apos;export ou la suppression groupée
                  </p>
                )}
              </div>

              {vendors.length > 0 && (
                <div>
                  <Label>Vendeur <span className="text-gray-400 text-xs">(optionnel)</span></Label>
                  <Popover open={vendorPopoverOpen} onOpenChange={setVendorPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={vendorPopoverOpen}
                        className="w-full mt-1 justify-between font-normal"
                      >
                        <span className="truncate">
                          {vendorId
                            ? (vendors.find((v) => String(v.id) === vendorId)?.name ?? "Vendeur inconnu")
                            : "— Aucun vendeur —"}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                      <Command shouldFilter={false}>
                        <CommandList className="max-h-52 overflow-y-auto">
                          <CommandEmpty>Aucun vendeur disponible.</CommandEmpty>
                          <CommandGroup>
                            <CommandItem
                              value="none"
                              onSelect={() => { setVendorId(""); setVendorPopoverOpen(false); }}
                            >
                              <Check className={`mr-2 h-4 w-4 ${!vendorId ? "opacity-100" : "opacity-0"}`} />
                              — Aucun vendeur —
                            </CommandItem>
                            {vendors.filter((v) => v.isActive).map((v) => (
                              <CommandItem
                                key={v.id}
                                value={String(v.id)}
                                onSelect={() => { setVendorId(String(v.id)); setVendorPopoverOpen(false); }}
                              >
                                <Check className={`mr-2 h-4 w-4 ${vendorId === String(v.id) ? "opacity-100" : "opacity-0"}`} />
                                <span className="flex-1">{v.name}</span>
                                {v.phone && <span className="text-xs text-gray-400 ml-2">{v.phone}</span>}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
              )}

              <div>
                <Button
                  type="submit"
                  className="w-full gap-2"
                  disabled={!selectedRouterId || !profile || !!progress}
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
                    <span className="text-xs text-gray-400 tabular-nums whitespace-nowrap">
                      Restants: {Math.max(0, progress.total - progress.done)}
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
          {lastLot ? (
            <Card className="overflow-hidden">
              {/* ── En-tête lot ── */}
              <div className="bg-gradient-to-r from-green-50 to-emerald-50 border-b border-green-100 px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                  <span className="text-xs font-semibold text-green-700 uppercase tracking-wide">Dernier lot généré</span>
                  <span className="ml-auto text-xs text-gray-400 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {new Date(lastLot.generatedAt).toLocaleString("fr-FR", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" })}
                  </span>
                </div>
                <p className="font-mono font-bold text-gray-900 text-sm break-all">{lastLot.comment}</p>
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700 border-0">
                    <Package className="h-3 w-3 mr-1" />{lastLot.vouchers.length} vouchers
                  </Badge>
                  {lastLot.profileName && (
                    <Badge variant="secondary" className="text-xs bg-purple-100 text-purple-700 border-0">
                      {lastLot.profileName}
                    </Badge>
                  )}
                  {lastLot.validity && (
                    <Badge variant="secondary" className="text-xs bg-orange-100 text-orange-700 border-0">
                      ⏱ {lastLot.validity}
                    </Badge>
                  )}
                  {lastLot.price && (
                    <Badge variant="secondary" className="text-xs bg-green-100 text-green-700 border-0">
                      {lastLot.price} FCFA
                    </Badge>
                  )}
                  {lastLot.vendorName && (
                    <Badge variant="secondary" className="text-xs bg-gray-100 text-gray-600 border-0">
                      {lastLot.vendorName}
                    </Badge>
                  )}
                  {lastLot.routerName && (
                    <Badge variant="secondary" className="text-xs bg-gray-100 text-gray-500 border-0">
                      <RouterIcon className="h-3 w-3 mr-1" />{lastLot.routerName}
                    </Badge>
                  )}
                </div>
              </div>

              {/* ── Bouton Imprimer proéminent ── */}
              <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap gap-2">
                <Button
                  className="flex-1 gap-2 bg-blue-600 hover:bg-blue-700 text-white"
                  onClick={() => handlePrint(lastLot)}
                >
                  <Printer className="h-4 w-4" /> Imprimer les tickets
                </Button>
                <Button size="default" variant="outline" className="gap-1.5" onClick={() => handleCopyAll(lastLot)} title="Copier tous les codes">
                  <Copy className="h-4 w-4" />
                </Button>
                <Button size="default" variant="outline" className="gap-1.5" onClick={() => handleExportTxt(lastLot)} title="Exporter .txt">
                  <FileText className="h-4 w-4" />
                </Button>
                <Button size="default" variant="outline" className="gap-1.5" onClick={() => handleExportCsv(lastLot)} title="Exporter .csv">
                  <Table2 className="h-4 w-4" />
                </Button>
              </div>

              {/* ── Liste des codes ── */}
              <div className="max-h-[420px] overflow-y-auto">
                <div className="divide-y divide-gray-50">
                  {lastLot.vouchers.map((v, i) => (
                    <div key={v.id ?? i} className="flex items-center gap-3 px-4 py-1.5 hover:bg-gray-50 transition-colors">
                      <span className="text-xs text-gray-300 w-6 text-right flex-shrink-0 tabular-nums">{i + 1}</span>
                      <code className="font-mono text-sm font-semibold text-gray-900 flex-1 select-all">{v.username}</code>
                      {v.username !== v.password && (
                        <code className="font-mono text-xs text-gray-400 flex-shrink-0 select-all">{v.password}</code>
                      )}
                      {v.validity && (
                        <span className="text-xs text-blue-500 flex-shrink-0">{v.validity}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          ) : loadingLastLot ? (
            <div className="flex flex-col items-center justify-center h-64 text-center border-2 border-dashed border-gray-200 rounded-xl bg-gray-50">
              <RefreshCw className="h-8 w-8 text-gray-300 mb-3 animate-spin" />
              <p className="text-sm font-medium text-gray-400">Chargement du dernier lot…</p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-center border-2 border-dashed border-gray-200 rounded-xl bg-gray-50">
              <Package className="h-10 w-10 text-gray-300 mb-3" />
              <p className="text-sm font-medium text-gray-400">Aucun lot disponible</p>
              <p className="text-xs text-gray-300 mt-1">Le dernier lot apparaîtra ici après la génération</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Print section — uses global @media print CSS ── */}
      <div id="voucher-print-section" style={{ display: "none" }} />
    </div>
  );
}
