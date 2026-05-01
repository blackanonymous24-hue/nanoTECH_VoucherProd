import { useState, useEffect } from "react";
import {
  useListRouterProfiles,
  useGenerateVouchers,
  getListVouchersQueryKey,
  getListRouterProfilesQueryKey,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Voucher } from "@workspace/api-client-react";
import { useRouterContext } from "@/contexts/RouterContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
import {
  Zap, Printer, Trash2, Router as RouterIcon, RefreshCw, FileText, Table2, CheckCircle2, Check, ChevronsUpDown, Clock, Package, Loader2, WifiOff,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getStoredPHP } from "@/pages/TicketTemplate";
import { printTickets } from "@/lib/print";

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

function clearLastLot() {
  try { localStorage.removeItem(LS_KEY); } catch { /* noop */ }
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** "3h"→"3H", "1d"→"1J", "30m"→"30M", "1w"→"1S" */
function validityCode(validity: string | null | undefined): string {
  if (!validity) return "";
  const s = validity.trim();
  // Conversions spéciales : 30 jours = 1 mois, 7 jours = 1 semaine
  if (/^30d$/i.test(s)) return "1M";
  if (/^7d$/i.test(s))  return "1S";
  const m = s.match(/^(\d+)([a-zA-Z]+)$/);
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

/** Détecte si l'erreur correspond à un routeur inaccessible (502 ou réseau). */
function isRouterUnreachable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;
  const response = e.response as Record<string, unknown> | undefined;
  if (response?.status === 502) return true;
  const msg = String(e.message ?? "").toLowerCase();
  return msg.includes("502") || msg.includes("contacter") || msg.includes("unreachable") || msg.includes("network error");
}

/** Attend que le routeur soit à nouveau accessible (ping toutes les 4s). */
async function waitForRouter(routerId: number, base: string): Promise<void> {
  for (;;) {
    await new Promise<void>((r) => setTimeout(r, 4000));
    try {
      const res = await fetch(`${base}/api/routers/${routerId}/ping?force=1`);
      if (res.ok) {
        const data = await res.json() as { success: boolean };
        if (data.success) return;
      }
    } catch { /* réseau encore indisponible, on réessaie */ }
  }
}

/**
 * Réconcilie l'état du lot avec le routeur après une erreur réseau ou un
 * timeout : un batch peut avoir abouti sur MikroTik sans que la réponse HTTP
 * nous parvienne. Sans ça, on régénérerait 50 vouchers de plus à chaque
 * tentative — d'où des lots qui finissent à 1050+ alors qu'on en a demandé
 * 1000. Renvoie la liste réelle des utilisateurs MikroTik portant ce
 * commentaire (cache invalidé côté serveur via `refresh=1`).
 */
async function fetchLotUsers(
  routerId: number,
  comment: string,
  base: string,
): Promise<Array<{ username: string; password: string; profile: string; comment: string | null }>> {
  const url = `${base}/api/routers/${routerId}/users?comment=${encodeURIComponent(comment)}&limit=5000&refresh=1`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as { users?: Array<{ username: string; password: string; profile: string; comment: string | null }> };
  return data.users ?? [];
}

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
  const [qty, setQty] = useState("1");
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
  const [isPrinting, setIsPrinting] = useState(false);
  const [isDeletingLastLot, setIsDeletingLastLot] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [genPaused, setGenPaused] = useState(false);
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
        const profileKey = getListRouterProfilesQueryKey(selectedRouterId);
        queryClient.setQueryData(profileKey, freshProfiles);
        queryClient.invalidateQueries({ queryKey: profileKey });
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

  // If a profile was renamed in MikroTik, clear stale selected value.
  useEffect(() => {
    if (!profile) return;
    if (!profiles.some((p) => p.name === profile)) {
      setProfile("");
    }
  }, [profiles, profile]);

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
    setGenPaused(false);

    const dlBytes = datalimit ? Math.round(parseFloat(datalimit) * mbgb) : undefined;
    const profilePrice = selectedProfile?.price ?? "";
    const profileValidity = selectedProfile?.validity ?? "";
    const BATCH_SIZE = 50;
    const allVouchers: Voucher[] = [];
    let done = 0;
    let lockAcquired = false;
    try {
      // Verrouille le routeur pour toute la session : la sync background
      // (vendor + usage) saute automatiquement les routeurs verrouillés.
      const lockResp = await fetch(`${BASE}/api/routers/${selectedRouterId}/generation-lock`, { method: "POST" });
      if (!lockResp.ok) {
        const lockReason = await lockResp.text().catch(() => "");
        throw new Error(lockReason || "Impossible de démarrer la génération: routeur verrouillé.");
      }
      lockAcquired = true;

      while (done < total) {
        const qtyBatch = Math.min(BATCH_SIZE, total - done);
        let batchOk = false;
        while (!batchOk) {
          try {
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
            batchOk = true;
          } catch (err) {
            if (isRouterUnreachable(err)) {
              setGenPaused(true);
              await waitForRouter(selectedRouterId, BASE);
              try {
                if (effectiveComment) {
                  const onRouter = await fetchLotUsers(selectedRouterId, effectiveComment, BASE);
                  if (onRouter.length > done) {
                    const knownNames = new Set(allVouchers.map((v) => v.username));
                    const missing = onRouter
                      .filter((u) => !knownNames.has(u.username))
                      .map<Voucher>((u) => ({
                        id: 0,
                        routerId: selectedRouterId,
                        vendorId: vendorId ? parseInt(vendorId, 10) : null,
                        username: u.username,
                        password: u.password,
                        profileName: u.profile,
                        price: profilePrice,
                        validity: profileValidity,
                        comment: u.comment ?? effectiveComment,
                        createdAt: new Date().toISOString(),
                        printedAt: null,
                        usedAt: null,
                        soldAt: null,
                      } as unknown as Voucher));
                    allVouchers.push(...missing);
                    done = allVouchers.length;
                    setProgress({ done, total });
                  }
                }
              } catch {
                // keep retrying current batch
              }
              setGenPaused(false);
            } else {
              throw err;
            }
          }
        }
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

      // Réinitialiser les paramètres de génération pour le prochain lot
      setComment(makeBatchId(passwordMode === "random" ? "up" : "vc"));
      setQty("1");
      setPrefix("");
      setTimelimit("");
      setDatalimit("");
      setVendorId("");
    } finally {
      // Toujours relâcher le verrou — même en cas d'erreur.
      if (lockAcquired) {
        void fetch(`${BASE}/api/routers/${selectedRouterId}/generation-lock`, { method: "DELETE" });
      }
      setProgress(null);
      setGenPaused(false);
    }
  };

  const handlePrint = async (lot: LastLot) => {
    const php = getStoredPHP();
    if (!php) {
      toast({
        title: "Aucun modèle de ticket configuré",
        description: "Allez dans Modèle de ticket pour charger votre template PHP.",
        variant: "destructive",
      });
      return;
    }
    const PRICE_COLORS: Record<string, string> = {
      "0":"#E50877","100":"#752CEB","200":"#804000","300":"#13C013","500":"#ECA352",
      "1000":"#F75418","1500":"#FF69B4","2500":"#F70000","3000":"#F70000",
    };
    const vouchers = lot.vouchers.map((v, idx) => ({
      hotspotname: (selectedRouter as any)?.hotspotName || lot.routerName,
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
    setIsPrinting(true);
    try {
      const resp = await fetch(`${BASE}/api/render-tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ php, vouchers }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      const toSlug = (s: string) => s.trim().replace(/\s+/g, "-");
      const toFileValidity = (v: string) => {
        const s = v.trim();
        const mk = s.match(/^(\d+)(h|d|m|w)$/i);
        if (mk) {
          const map: Record<string, string> = { h: "Heure", d: "Jour", m: "Minute", w: "Semaine" };
          return mk[1] + (map[mk[2].toLowerCase()] ?? mk[2].toUpperCase());
        }
        return s.replace(/[\s-]+/g, "");
      };
      const rawValidity = lot.validity || lot.vouchers[0]?.validity || "";
      const compactValidity = toFileValidity(rawValidity);
      const hotspotName = (selectedRouter as any)?.hotspotName || lot.routerName;
      const profileSlug = lot.profileName.trim().split(/\s+/)[0] ?? lot.profileName;
      const printParts = ["Voucher", toSlug(hotspotName), compactValidity, lot.comment, profileSlug].filter(Boolean);
      printTickets(data.html as string[], printParts.join("-"));
    } catch (err: unknown) {
      toast({ title: "Erreur impression PHP", description: String(err), variant: "destructive" });
    } finally {
      setIsPrinting(false);
    }
  };

  const downloadFile = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const handleDeleteLastLot = async (lot: LastLot) => {
    if (!lot.routerId || !lot.comment) return;
    const confirmed = window.confirm(
      `Supprimer ce lot sur MikroTik ?\n\nLot: ${lot.comment}\nRouteur: ${lot.routerName || lot.routerId}\n\nCette action est irréversible.`,
    );
    if (!confirmed) return;
    setIsDeletingLastLot(true);
    try {
      const resp = await fetch(
        `${BASE}/api/routers/${lot.routerId}/users?comment=${encodeURIComponent(lot.comment)}`,
        { method: "DELETE" },
      );
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data?.error || "Suppression impossible sur le routeur.");
      }

      clearLastLot();
      setLastLot(null);
      queryClient.invalidateQueries({ queryKey: getListVouchersQueryKey() });
      toast({
        title: "Dernier lot supprimé",
        description: `${Number(data?.deleted ?? 0)} utilisateur(s) supprimé(s) sur MikroTik.`,
      });
    } catch (err) {
      toast({
        title: "Suppression échouée",
        description: String(err),
        variant: "destructive",
      });
    } finally {
      setIsDeletingLastLot(false);
    }
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
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={profilePopoverOpen}
                      disabled={!selectedRouterId || loadingProfiles}
                      className="w-full mt-1 justify-between font-normal"
                    >
                      <span className="truncate">
                        {loadingProfiles
                          ? "Chargement…"
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
                              onSelect={() => {
                                setProfile(p.name);
                                setProfilePopoverOpen(false);
                              }}
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
                  <div className="mt-2 space-y-1.5">
                    <div className="relative h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${genPaused ? "bg-amber-400" : "bg-orange-500"}`}
                        style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                      />
                      {!genPaused && (
                        <div
                          className="absolute inset-0 animate-shimmer"
                          style={{
                            background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.45) 50%, transparent 100%)",
                            backgroundSize: "200% 100%",
                          }}
                        />
                      )}
                    </div>
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      {genPaused ? (
                        <span className="flex items-center gap-1 text-amber-600 font-medium">
                          <WifiOff className="h-3 w-3" />
                          Routeur inaccessible — reprise automatique…
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <Loader2 className="h-3 w-3 animate-spin text-orange-500" />
                          Envoi vers MikroTik…
                        </span>
                      )}
                      <span className="tabular-nums font-medium">
                        {progress.done} / {progress.total}
                        <span className="text-gray-400 font-normal ml-1">
                          ({Math.round((progress.done / progress.total) * 100)}%)
                        </span>
                      </span>
                    </div>
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

              {/* Dernier lot — barre d’actions : ne pas rétablir l’ancien bouton « copier tout » ni retirer export / suppression ; garder ce jeu de boutons. */}
              {/* ── Bouton Imprimer proéminent ── */}
              <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap gap-2">
                <Button
                  className="flex-1 gap-2 bg-blue-600 hover:bg-blue-700 text-white"
                  onClick={() => handlePrint(lastLot)}
                  disabled={isPrinting}
                >
                  {isPrinting
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Printer className="h-4 w-4" />}
                  {isPrinting ? "Impression en cours..." : "Imprimer les tickets"}
                </Button>
                <Button size="default" variant="outline" className="gap-1.5" onClick={() => handleExportTxt(lastLot)} title="Exporter .txt">
                  <FileText className="h-4 w-4" />
                </Button>
                <Button size="default" variant="outline" className="gap-1.5" onClick={() => handleExportCsv(lastLot)} title="Exporter .csv">
                  <Table2 className="h-4 w-4" />
                </Button>
                <Button
                  size="default"
                  variant="outline"
                  className="gap-1.5 text-red-600 hover:text-red-700"
                  onClick={() => void handleDeleteLastLot(lastLot)}
                  title="Supprimer ce lot"
                  disabled={isDeletingLastLot}
                >
                  {isDeletingLastLot ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
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
              <div className="w-full max-w-sm space-y-2 px-6">
                <Skeleton className="h-5 w-40 mx-auto" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-5/6 mx-auto" />
              </div>
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
