import { useState, useEffect, useMemo } from "react";
import {
  useGenerateVouchers,
  getListVouchersQueryKey,
  getListRouterProfilesQueryKey,
} from "@workspace/api-client-react";
import type { HotspotProfile } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Voucher } from "@workspace/api-client-react";
import { useRouterContext } from "@/contexts/RouterContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
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
  Zap, Printer, Trash2, Router as RouterIcon, RefreshCw, Table2, CheckCircle2, Check, Copy, ChevronsUpDown, Clock, Package, Loader2, WifiOff,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fetchServerTemplateWithMeta, readWebScale, readMobileScale } from "@/pages/TicketTemplate";
import { printTickets, tryOpenVoucherPrintPage, buildTicketPrintHtml } from "@/lib/print";
import { setApiRequestPause } from "@/lib/installAuthFetch";
import { sortRouterProfilesByCreationOrder } from "@/lib/routerProfilesSort";

const LS_KEY = "vouchernet-last-lot";
const PROFILES_CACHE_KEY = "generate-profiles-cache:v1";
const FORFAITS_PROFILES_CACHE_KEY = "forfaits-cache";

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

function lastLotStorageKey(routerId: number): string {
  return `${LS_KEY}:${routerId}`;
}

function loadLastLot(routerId: number | null | undefined): LastLot | null {
  if (!routerId) return null;
  try {
    const raw = localStorage.getItem(lastLotStorageKey(routerId));
    if (raw) return JSON.parse(raw) as LastLot;
    // Backward compatibility with legacy single-key storage.
    const legacy = localStorage.getItem(LS_KEY);
    if (!legacy) return null;
    const parsed = JSON.parse(legacy) as LastLot;
    return parsed?.routerId === routerId ? parsed : null;
  } catch {
    return null;
  }
}

function saveLastLot(lot: LastLot) {
  try {
    localStorage.setItem(lastLotStorageKey(lot.routerId), JSON.stringify(lot));
    // Keep legacy key in sync for users upgrading across versions.
    localStorage.setItem(LS_KEY, JSON.stringify(lot));
  } catch {
    /* noop */
  }
}

function clearLastLot(routerId: number | null | undefined) {
  try {
    if (routerId) localStorage.removeItem(lastLotStorageKey(routerId));
    localStorage.removeItem(LS_KEY);
  } catch {
    /* noop */
  }
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** Détecte si l'app tourne dans le WebView de l'APK Expo nanoTECH */
const isNativeApp =
  typeof navigator !== "undefined" &&
  /nanoTECH-VouchersBills-Mobile/i.test(navigator.userAgent);

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

/**
 * Calcule le préfixe automatique à partir de la validité du profil.
 * Conventions : h=heure, j=jour, s=semaine, M=mois.
 * Cas stricts : 7d/1w→1s, 14d/2w→2s, 30d/31d→1M.
 */
function computeAutoPrefix(validity: string | null | undefined, ticketLetter: string | null | undefined): string {
  if (!validity) return "";
  const sl = validity.trim().toLowerCase();
  let code = "";
  if (sl === "30d" || sl === "31d") code = "1M";
  else if (sl === "2w" || sl === "14d") code = "2S";
  else if (sl === "1w" || sl === "7d") code = "1S";
  else {
    const m = sl.match(/^(\d+)([a-z]+)$/);
    if (!m) return "";
    const [, num, unit] = m;
    if (unit === "h") code = `${num}H`;
    else if (unit === "d") code = `${num}J`;
    else if (unit === "w") code = `${num}S`;
    else if (unit === "m") code = `${num}M`;
    else return "";
  }
  return (code + (ticketLetter?.trim() || "")).toLowerCase();
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
  // Interruption intentionnelle du fetch (logout, AbortController) — pas une panne réseau.
  if (e.name === "AbortError") return false;
  const response = e.response as Record<string, unknown> | undefined;
  if (response?.status === 502) return true;
  const msg = String(e.message ?? "").toLowerCase();
  return (
    msg.includes("502") ||
    msg.includes("contacter") ||
    msg.includes("unreachable") ||
    msg.includes("network error") ||
    msg.includes("failed to fetch") ||   // Chrome / Firefox hors-ligne
    msg.includes("load failed")           // Safari hors-ligne
  );
}

/** Attend que le routeur soit à nouveau accessible (ping toutes les 4s).
 *  Chaque tentative est limitée à 10 s pour ne pas rester figé si le serveur
 *  API lui-même met du temps à répondre après un redémarrage.
 */
async function waitForRouter(routerId: number, base: string): Promise<void> {
  for (;;) {
    await new Promise<void>((r) => setTimeout(r, 4000));
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10_000);
      try {
        const res = await fetch(`${base}/api/routers/${routerId}/ping?force=1`, { signal: ctrl.signal });
        clearTimeout(timer);
        if (res.ok) {
          const data = await res.json() as { success: boolean };
          if (data.success) return;
        }
      } finally {
        clearTimeout(timer);
      }
    } catch { /* réseau encore indisponible ou timeout — on réessaie */ }
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
  // Timeout de 20 s : évite de rester figé sur la réconciliation si le routeur
  // est lent à répondre juste après être revenu en ligne.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return [];
    const data = (await res.json()) as { users?: Array<{ username: string; password: string; profile: string; comment: string | null }> };
    return data.users ?? [];
  } finally {
    clearTimeout(timer);
  }
}

type ProfileForLot = { name: string; price?: string | null; validity?: string | null };

/**
 * Charge le lot le plus récent encore présent sur le routeur (GET /lots trié du plus récent au plus ancien).
 * Si le premier lot n’a plus d’utilisateurs, essaie le suivant — utile après suppression du dernier lot.
 */
async function loadMostRecentLotFromRouter(
  routerId: number,
  base: string,
  profiles: ProfileForLot[],
  routerName: string,
  signal?: AbortSignal,
): Promise<LastLot | null> {
  let lotsRes: Response;
  try {
    lotsRes = await fetch(`${base}/api/routers/${routerId}/lots`, { signal });
  } catch {
    return null;
  }
  if (!lotsRes.ok) return null;
  const { lots: apiLots } = (await lotsRes.json()) as {
    lots: Array<{ name: string; count: number; profile: string | null }>;
  };
  if (!apiLots.length) return null;

  for (const apiLot of apiLots) {
    let usersRes: Response;
    try {
      usersRes = await fetch(
        `${base}/api/routers/${routerId}/users?comment=${encodeURIComponent(apiLot.name)}&limit=5000`,
        { signal },
      );
    } catch {
      continue;
    }
    if (!usersRes.ok) continue;
    const { users } = (await usersRes.json()) as {
      users: Array<{ username: string; password: string; profile: string }>;
    };
    if (!users.length) continue;

    const prof = profiles.find((p) => p.name === apiLot.profile);
    return {
      vouchers: users.map((u, i) => ({
        id: i,
        routerId,
        username: u.username,
        password: u.password,
        profileName: u.profile ?? apiLot.profile ?? "",
        price: prof?.price ?? "",
        validity: prof?.validity ?? "",
        createdAt: new Date().toISOString(),
      })),
      comment: apiLot.name,
      routerName,
      routerId,
      profileName: apiLot.profile ?? "",
      price: prof?.price ?? "",
      validity: prof?.validity ?? "",
      vendorName: "",
      generatedAt: new Date().toISOString(),
    };
  }
  return null;
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
  const [prefixAuto, setPrefixAuto] = useState<boolean>(() => {
    try { return localStorage.getItem("vn_prefix_auto") === "1"; } catch { return false; }
  });
  const [passwordMode, setPasswordMode] = useState<"same" | "random">("same");
  const [charType, setCharType] = useState<CharType>("mix");
  const [userLength, setUserLength] = useState("5");
  const [timelimit, setTimelimit] = useState("");
  const [datalimit, setDatalimit] = useState("");
  const [mbgb, setMbgb] = useState<number>(1048576);
  const [comment, setComment] = useState(() => makeBatchId("vc"));
  const [vendorId, setVendorId] = useState<string>("");
  const [lastLot, setLastLot] = useState<LastLot | null>(null);
  const [loadingLastLot, setLoadingLastLot] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [copiedLot, setCopiedLot] = useState(false);
  const [isDeletingLastLot, setIsDeletingLastLot] = useState(false);
  const [confirmDeleteLastLot, setConfirmDeleteLastLot] = useState<LastLot | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [genPaused, setGenPaused] = useState(false);
  const [profilePopoverOpen, setProfilePopoverOpen] = useState(false);
  const [vendorPopoverOpen, setVendorPopoverOpen] = useState(false);
  const [justGenerated, setJustGenerated] = useState(false);
  const autoLoadAttempted = useState(() => new Set<number>())[0];

  useEffect(() => {
    if (selectedRouterId) {
      // Re-allow auto-load flow on each router switch so loading UI stays consistent.
      autoLoadAttempted.delete(selectedRouterId);
    }
    setLastLot(loadLastLot(selectedRouterId));
    // Réinitialise le vendeur et le profil sélectionnés (spécifiques à chaque routeur)
    setVendorId("");
    setProfile("");
  }, [selectedRouterId, autoLoadAttempted]);

  // Auto-select length 5 when a mix format is chosen in Mode Voucher
  useEffect(() => {
    if (passwordMode === "same" && (charType === "mix" || charType === "mix1" || charType === "mix2")) {
      setUserLength("5");
    }
  }, [charType, passwordMode]);

  const GEN_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
  const { data: vendors = [] } = useQuery<{ id: number; name: string; isActive?: boolean; phone?: string | null; ticketLetter?: string | null }[]>({
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

  // Profils du routeur courant : chargés uniquement via le fetch ci‑dessous (pas
  // useListRouterProfiles avec placeholderData), sinon au changement de routeur
  // React Query peut encore exposer la liste du routeur précédent et corrompre
  // le localStorage sous la mauvaise clé.
  const [profilesRefreshing, setProfilesRefreshing] = useState(false);
  const [localProfiles, setLocalProfiles] = useState<HotspotProfile[]>([]);
  const [profilesForRouterId, setProfilesForRouterId] = useState<number | null>(null);
  const localProfilesCacheKey = selectedRouterId ? `${PROFILES_CACHE_KEY}:${selectedRouterId}` : null;
  const displayedProfiles = profilesForRouterId === selectedRouterId ? localProfiles : [];
  const displayedProfilesSorted = useMemo(
    () => sortRouterProfilesByCreationOrder(displayedProfiles),
    [displayedProfiles],
  );

  const generateMutation = useGenerateVouchers();

  useEffect(() => {
    // Hard reset on router switch to avoid showing stale profiles
    // from a previously selected router for even a single render.
    setLocalProfiles([]);
    setProfilesForRouterId(null);
    setProfile("");
    setProfilePopoverOpen(false);
  }, [selectedRouterId]);

  useEffect(() => {
    if (!localProfilesCacheKey) {
      setLocalProfiles([]);
      setProfilesForRouterId(null);
      return;
    }
    try {
      const fromGenerate = localStorage.getItem(localProfilesCacheKey);
      if (fromGenerate) {
        const parsed = JSON.parse(fromGenerate);
        setLocalProfiles(Array.isArray(parsed) ? parsed : []);
        setProfilesForRouterId(selectedRouterId ?? null);
        return;
      }
      const fromForfaits = localStorage.getItem(`${FORFAITS_PROFILES_CACHE_KEY}:${selectedRouterId}`);
      if (fromForfaits) {
        const parsed = JSON.parse(fromForfaits);
        setLocalProfiles(Array.isArray(parsed) ? parsed : []);
        setProfilesForRouterId(selectedRouterId ?? null);
        return;
      }
      setLocalProfiles([]);
      setProfilesForRouterId(null);
    } catch {
      setLocalProfiles([]);
      setProfilesForRouterId(null);
    }
  }, [localProfilesCacheKey, selectedRouterId]);

  // Always refresh profiles when router changes so Generate uses
  // the exact profile list of the currently selected router.
  useEffect(() => {
    if (!selectedRouterId) return;
    let cancelled = false;
    setProfilesRefreshing(true);
    void (async () => {
      try {
        const res = await fetch(`/api/routers/${selectedRouterId}/profiles?refresh=1`);
        if (!res.ok || cancelled) return;
        const freshProfiles = (await res.json()) as HotspotProfile[];
        if (!Array.isArray(freshProfiles) || cancelled) return;
        setLocalProfiles(freshProfiles);
        setProfilesForRouterId(selectedRouterId);
        const profileKey = getListRouterProfilesQueryKey(selectedRouterId);
        queryClient.setQueryData(profileKey, freshProfiles);
        queryClient.invalidateQueries({ queryKey: profileKey });
        try {
          localStorage.setItem(`${PROFILES_CACHE_KEY}:${selectedRouterId}`, JSON.stringify(freshProfiles));
          localStorage.setItem(`${FORFAITS_PROFILES_CACHE_KEY}:${selectedRouterId}`, JSON.stringify(freshProfiles));
        } catch {
          // ignore storage errors
        }
      } catch {
        // keep local cache fallback if live refresh fails
      } finally {
        if (!cancelled) setProfilesRefreshing(false);
      }
    })();
    return () => {
      cancelled = true;
      setProfilesRefreshing(false);
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
        const lot = await loadMostRecentLotFromRouter(
          selectedRouterId,
          GEN_BASE,
          displayedProfilesSorted,
          selectedRouter?.name ?? "",
          controller.signal,
        );
        if (lot) {
          setLastLot(lot);
          saveLastLot(lot);
        }
      } catch {
        // Router offline or aborted — keep "Aucun lot" state, user can generate
      } finally {
        setLoadingLastLot(false);
      }
    })();

    return () => controller.abort();
  }, [selectedRouterId, lastLot, displayedProfilesSorted, selectedRouter, autoLoadAttempted]);

  const selectedProfile = displayedProfilesSorted.find((p) => p.name === profile);
  const selectedProfileMonitorOk = selectedProfile?.schedulerMonitorActive === true;

  // If a profile was renamed in MikroTik, clear stale selected value.
  useEffect(() => {
    if (!profile) return;
    if (!displayedProfilesSorted.some((p) => p.name === profile)) {
      setProfile("");
    }
  }, [displayedProfilesSorted, profile]);

  const selectedVendor = vendors.find((v) => String(v.id) === vendorId);
  const vendorSuffix =
    selectedVendor && selectedProfile?.validity
      ? `-${validityCode(selectedProfile.validity)}${selectedVendor.name.toUpperCase()}`
      : selectedVendor
      ? `-${selectedVendor.name.toUpperCase()}`
      : "";
  const effectiveComment = comment + vendorSuffix;

  useEffect(() => {
    try { localStorage.setItem("vn_prefix_auto", prefixAuto ? "1" : "0"); } catch { /* noop */ }
  }, [prefixAuto]);

  useEffect(() => {
    if (!prefixAuto) return;
    setPrefix(computeAutoPrefix(selectedProfile?.validity, selectedVendor?.ticketLetter));
  }, [prefixAuto, selectedProfile?.validity, selectedVendor?.ticketLetter]);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRouterId || !profile) return;

    // During generation, pause unrelated API traffic and keep only generation-critical
    // endpoints so RouterOS bandwidth is dedicated to voucher creation.
    setApiRequestPause(true, {
      // Sous-chemin Vite (BASE_URL) : le pathname peut être `/app/api/...` — pas seulement `/api/...`.
      allowPathPatterns: [
        /\/api\/vouchers\/generate(?:$|[/?#])/,
        /\/api\/routers\/\d+\/generation-lock(?:$|[/?#])/,
        /\/api\/routers\/\d+\/users(?:$|[/?#])/,
        // Sinon waitForRouter() est bloqué par installAuthFetch et la reprise
        // automatique ne peut jamais détecter que le routeur est de nouveau en ligne.
        /\/api\/routers\/\d+\/ping(?:$|[/?#])/,
      ],
    });

    const total = parseInt(qty, 10);
    setProgress({ done: 0, total });
    setGenPaused(false);
    generateMutation.reset();

    const dlBytes = datalimit ? Math.round(parseFloat(datalimit) * mbgb) : undefined;
    const profilePrice = selectedProfile?.price ?? "";
    const profileValidity = selectedProfile?.validity ?? "";
    // 200 par batch : 4× moins d'aller-retours HTTP pour les gros lots (>1000).
    // Le serveur gère jusqu'à 64 writers parallèles et tolère 120 s par batch.
    const BATCH_SIZE = 200;
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
        let batchOk = false;
        // Compteur d'échecs consécutifs "routeur inaccessible" :
        // on tolère 1 erreur passagère sans afficher le message ni bloquer.
        let unreachableStreak = 0;
        while (!batchOk) {
          // Recalculer qtyBatch à chaque tentative (y compris après une
          // récupération qui a mis à jour `done`) pour ne jamais dépasser `total`.
          const qtyBatch = Math.min(BATCH_SIZE, total - done);
          if (qtyBatch <= 0) { batchOk = true; break; }
          try {
            const generated = await generateMutation.mutateAsync({
              // Cast to any — the server accepts extra fields (charType, userLength,
              // timelimit, datalimit) not yet reflected in the generated OpenAPI types.
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
              } as any,
            });
            allVouchers.push(...generated);
            done = Math.min(allVouchers.length, total); // jamais dépasser total
            setProgress({ done, total });
            batchOk = true;
            unreachableStreak = 0;
          } catch (err) {
            if (isRouterUnreachable(err)) {
              unreachableStreak++;
              generateMutation.reset();
              if (unreachableStreak === 1) {
                // 1er échec passager : retry silencieux après 3 s, sans afficher le message.
                await new Promise<void>((r) => setTimeout(r, 3000));
                continue;
              }
              // 2ème échec consécutif → routeur vraiment hors-ligne.
              setGenPaused(true);
              await waitForRouter(selectedRouterId, BASE);
              unreachableStreak = 0;
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
                    done = Math.min(allVouchers.length, total);
                    setProgress({ done, total });
                  }
                }
              } catch {
                // keep retrying current batch
              }
              // Si la récupération nous a amenés à `total`, pas besoin de générer plus.
              if (done >= total) batchOk = true;
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
      setProfile("");
      setJustGenerated(true);

      // Auto-print uniquement dans l'APK Expo (User-Agent nanoTECH-VouchersBills-Mobile)
      if (isNativeApp) {
        void handlePrint(lot);
      }
    } finally {
      setApiRequestPause(false);
      // Toujours relâcher le verrou — même en cas d'erreur.
      if (lockAcquired) {
        void fetch(`${BASE}/api/routers/${selectedRouterId}/generation-lock`, { method: "DELETE" });
      }
      setProgress(null);
      setGenPaused(false);
    }
  };

  const handlePrint = async (lot: LastLot) => {
    // ── Pré-ouvrir la fenêtre ICI, AVANT tout await ──────────────────────────
    // Sur navigateur mobile, window.open après un await est traité comme un
    // popup et bloqué. On l'ouvre de manière synchrone pendant le gestionnaire
    // de clic, puis on y écrit le HTML une fois prêt.
    const isNativeWV = typeof (window as any).ReactNativeWebView !== "undefined";
    const isMobileBrowser = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const printScale = (isNativeWV || isMobileBrowser) ? readMobileScale() : readWebScale();
    // MikHmon : nouvel onglet sur tous les écrans (mobile + desktop), sauf APK WebView natif
    const preWin: Window | null = isNativeWV ? null : window.open("", "_blank");

    if (preWin) {
      preWin.document.write(`<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Chargement…</title>
<style>
  body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;
    background:#f8f9fa;font-family:system-ui,sans-serif;flex-direction:column;gap:20px;color:#444}
  .spinner{width:56px;height:56px;border:5px solid #e0e0e0;border-top-color:#2563eb;
    border-radius:50%;animation:spin 0.9s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  p{font-size:1.05rem;text-align:center;max-width:280px;line-height:1.5;margin:0}
</style></head>
<body><div class="spinner"></div>
<p>Les tickets vont s'afficher dans un instant,<br>veuillez patienter…</p>
</body></html>`);
      preWin.document.close();
    }

    const hotspotName = (selectedRouter as any)?.hotspotName || lot.routerName;
    if (lot.comment && await tryOpenVoucherPrintPage(lot.comment, hotspotName)) {
      preWin?.close();
      toast({
        title: "Impression Mikhmon",
        description: "Ouverture de la page print.php (mobile) pour refresh/réimpression.",
      });
      return;
    }
    const { template: php, isDefault: isMikHmonDefault } = await fetchServerTemplateWithMeta();
    const isMikHmon = isMikHmonDefault || php.includes('class="voucher"');
    const mobileRowsPerPage = isMikHmon ? 9 : 6;
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
      const profileSlug = lot.profileName.trim().split(/\s+/)[0] ?? lot.profileName;
      const printParts = ["Voucher", toSlug(hotspotName), compactValidity, lot.comment, profileSlug].filter(Boolean);
      const title = printParts.join("-");

      const genCols = isMikHmon ? 5 : 4;
      if (preWin) {
        const html = buildTicketPrintHtml(data.html as string[], title, printScale, true, mobileRowsPerPage, genCols, genCols);
        preWin.document.open();
        preWin.document.write(html);
        preWin.document.close();
      } else {
        // APK WebView natif uniquement
        printTickets(data.html as string[], title, printScale, genCols);
      }
    } catch (err: unknown) {
      preWin?.close();
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
    setConfirmDeleteLastLot(null);
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

      queryClient.invalidateQueries({ queryKey: getListVouchersQueryKey() });
      const nextLot = await loadMostRecentLotFromRouter(
        lot.routerId,
        GEN_BASE,
        displayedProfilesSorted,
        selectedRouter?.name ?? lot.routerName ?? "",
      );
      if (nextLot) {
        setLastLot(nextLot);
        saveLastLot(nextLot);
      } else {
        clearLastLot(lot.routerId);
        autoLoadAttempted.delete(lot.routerId);
        setLoadingLastLot(true);
        setLastLot(null);
      }
      toast({
        title: "Lot supprimé",
        description:
          nextLot
            ? `${Number(data?.deleted ?? 0)} utilisateur(s) supprimé(s). Le lot affiché est désormais le plus récent encore présent sur le routeur.`
            : `${Number(data?.deleted ?? 0)} utilisateur(s) supprimé(s) sur MikroTik.`,
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

  const handleCopyVouchers = async (lot: LastLot) => {
    const lines = lot.vouchers.map((v) =>
      v.username !== v.password ? `${v.username} / ${v.password}` : v.username
    );
    await navigator.clipboard.writeText(lines.join("\n"));
    setCopiedLot(true);
    setTimeout(() => setCopiedLot(false), 2000);
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
      <div className="mb-2">
        <h1 className="text-lg font-bold text-gray-900 leading-tight">Générer des vouchers</h1>
        <p className="text-xs text-gray-500">Créez des comptes hotspot sur votre routeur MikroTik</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="py-2 px-4">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-blue-500" /> Paramètres de génération
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            <form onSubmit={handleGenerate} className="form-shell space-y-1.5">

              {selectedRouter ? (
                <div className="flex items-center gap-2 px-2.5 py-1.5 bg-blue-50 border border-blue-200 rounded-lg">
                  <RouterIcon className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-blue-900 truncate">{selectedRouter.name}</p>
                    <p className="text-[10px] text-blue-500">{selectedRouter.host}:{selectedRouter.port}</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-700 px-3 py-1.5 rounded-lg text-xs">
                  <RouterIcon className="h-3.5 w-3.5 flex-shrink-0" />
                  Sélectionnez un routeur dans la barre latérale pour commencer
                </div>
              )}

              <div>
                <Label className="text-xs">Profil</Label>
                <Popover open={profilePopoverOpen} onOpenChange={setProfilePopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={profilePopoverOpen}
                      disabled={!selectedRouterId || (profilesRefreshing && displayedProfilesSorted.length === 0)}
                      className="w-full mt-0.5 h-8 text-xs justify-between font-normal"
                    >
                      <span className="truncate flex items-center gap-2">
                        {(profilesRefreshing && displayedProfilesSorted.length === 0) ? (
                          "Chargement…"
                        ) : profile ? (
                          <>
                            <span
                              className={`h-2 w-2 rounded-full flex-shrink-0 ${
                                selectedProfileMonitorOk ? "bg-emerald-500" : "bg-orange-400"
                              }`}
                              aria-hidden
                            />
                            <span className="truncate">{selectedProfile?.name ?? profile}</span>
                          </>
                        ) : (
                          "Sélectionner un profil"
                        )}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                    <Command shouldFilter={false}>
                      <CommandList className="max-h-52 overflow-y-auto">
                        <CommandEmpty>Aucun profil disponible.</CommandEmpty>
                        <CommandGroup>
                          {displayedProfilesSorted.map((p) => (
                            <CommandItem
                              key={p.name}
                              value={p.name}
                              onSelect={() => {
                                setProfile(p.name);
                                setProfilePopoverOpen(false);
                                setJustGenerated(false);
                              }}
                            >
                              <Check className={`mr-2 h-4 w-4 shrink-0 ${profile === p.name ? "opacity-100" : "opacity-0"}`} />
                              <span
                                className={`mr-1.5 h-2 w-2 rounded-full shrink-0 ${
                                  p.schedulerMonitorActive === true ? "bg-emerald-500" : "bg-orange-400"
                                }`}
                                aria-hidden
                              />
                              <span className="flex-1 truncate">{p.name}</span>
                              {(p.validity || p.price) && (
                                <span className="text-xs text-muted-foreground ml-2 shrink-0 tabular-nums">
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
                  <div className="mt-1 px-2 py-1 bg-blue-50 rounded text-xs text-blue-700 flex flex-wrap gap-x-3 gap-y-0.5">
                    {selectedProfile.validity && (
                      <span>⏱ <strong>{selectedProfile.validity}</strong></span>
                    )}
                    {selectedProfile.price && (
                      <span>💰 <strong>{selectedProfile.price}</strong></span>
                    )}
                    {selectedProfile.rateLimit && (
                      <span>📶 <strong>{selectedProfile.rateLimit}</strong></span>
                    )}
                    {selectedProfile.lockMac && (
                      <span>🔒 MAC</span>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 items-end">
                <div>
                  <Label className="text-xs">Quantité</Label>
                  <Input
                    className="mt-0.5 h-8 text-xs"
                    type="number"
                    min={1}
                    max={5000}
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <input
                      id="prefix-auto-check"
                      type="checkbox"
                      className="h-3 w-3 accent-blue-600 cursor-pointer"
                      checked={prefixAuto}
                      onChange={(e) => setPrefixAuto(e.target.checked)}
                    />
                    <Label htmlFor="prefix-auto-check" className="text-xs cursor-pointer">
                      Préfixe <span className="text-gray-400">{prefixAuto ? "(auto)" : "(opt.)"}</span>
                    </Label>
                  </div>
                  <Input
                    className="mt-0.5 h-8 text-xs"
                    placeholder={prefixAuto ? "" : "ex: 1j-"}
                    value={prefix}
                    onChange={(e) => { if (!prefixAuto) setPrefix(e.target.value); }}
                    readOnly={prefixAuto}
                  />
                </div>
              </div>

              <div>
                <Label className="mb-0.5 block text-xs">Mode de connexion</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => { setPasswordMode("same"); setComment(makeBatchId("vc")); }}
                    className={`py-1 px-2 rounded-lg border text-xs font-medium transition-colors text-left ${
                      passwordMode === "same"
                        ? "bg-blue-50 border-blue-400 text-blue-700"
                        : "border-gray-200 text-gray-500 hover:border-gray-300"
                    }`}
                  >
                    <span className="whitespace-nowrap">Mode Ticket <span className="font-normal opacity-70">(user=pass)</span></span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPasswordMode("random"); setComment(makeBatchId("up")); }}
                    className={`py-1 px-2 rounded-lg border text-xs font-medium transition-colors text-left ${
                      passwordMode === "random"
                        ? "bg-blue-50 border-blue-400 text-blue-700"
                        : "border-gray-200 text-gray-500 hover:border-gray-300"
                    }`}
                  >
                    <span className="whitespace-nowrap">Mode Compte <span className="font-normal opacity-70">(user&amp;pass)</span></span>
                  </button>
                </div>
              </div>

              {/* ─ Format + Longueur ─ */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Format</Label>
                  <select
                    className="mt-0.5 w-full h-8 border border-input bg-background rounded-md px-2 text-xs font-mono"
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
                  <Label className="text-xs">Longueur</Label>
                  <select
                    className="mt-0.5 w-full h-8 border border-input bg-background rounded-md px-2 text-xs font-mono"
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
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Tps <span className="text-gray-400">(opt.)</span></Label>
                  <Input
                    className="mt-0.5 h-8 text-xs font-mono"
                    placeholder="1h, 30m"
                    value={timelimit}
                    onChange={(e) => setTimelimit(e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-xs">Data <span className="text-gray-400">(opt.)</span></Label>
                  <div className="flex gap-1 mt-0.5">
                    <Input
                      type="number"
                      min={0}
                      placeholder="0"
                      value={datalimit}
                      onChange={(e) => setDatalimit(e.target.value)}
                      className="h-8 text-xs"
                    />
                    <select
                      className="border border-input bg-background rounded-md px-1.5 text-xs h-8"
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
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Identifiant de lot</Label>
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
                  className="h-8 text-xs"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="ex: LOT-20260101-0900"
                />
                {vendorSuffix && (
                  <p className="text-xs mt-0.5 font-mono">
                    <span className="text-gray-400">ID final : </span>
                    <span className="text-gray-600">{comment}</span>
                    <span className="text-blue-600 font-semibold">{vendorSuffix}</span>
                  </p>
                )}
              </div>

              {vendors.length > 0 && (
                <div>
                  <Label className="text-xs">Vendeur <span className="text-gray-400">(optionnel)</span></Label>
                  <Popover open={vendorPopoverOpen} onOpenChange={setVendorPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={vendorPopoverOpen}
                        className="w-full mt-0.5 h-8 text-xs justify-between font-normal"
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
                  type={justGenerated && lastLot ? "button" : "submit"}
                  className="w-full gap-1.5 h-9 text-sm"
                  disabled={
                    justGenerated && lastLot
                      ? isPrinting
                      : !selectedRouterId || !profile || !!progress
                  }
                  onClick={
                    justGenerated && lastLot
                      ? () => void handlePrint(lastLot)
                      : undefined
                  }
                >
                  {justGenerated && lastLot ? (
                    <>
                      {isPrinting
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Printer className="h-3.5 w-3.5" />}
                      {isPrinting ? "Impression…" : "Imprimer"}
                    </>
                  ) : (
                    <>
                      <Zap className="h-3.5 w-3.5" />
                      {progress ? "Génération en cours..." : `Générer ${qty} voucher(s)`}
                    </>
                  )}
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

              {generateMutation.isError && !genPaused && (
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
              <div className="bg-gradient-to-r from-green-50 to-emerald-50 border-b border-green-100 px-3 py-2">
                <div className="flex items-center gap-1.5 mb-1">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
                  <span className="text-xs font-semibold text-green-700 uppercase tracking-wide">Dernier lot généré</span>
                  <span className="ml-auto text-xs text-gray-400 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {new Date(lastLot.generatedAt).toLocaleString("fr-FR", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" })}
                  </span>
                </div>
                <p className="font-mono font-bold text-gray-900 text-xs break-all">{lastLot.comment}</p>
                <div className="flex flex-wrap items-center gap-1 mt-1">
                  <Badge variant="secondary" className="text-[10px] py-0 px-1.5 h-4 bg-blue-100 text-blue-700 border-0">
                    <Package className="h-2.5 w-2.5 mr-0.5" />{lastLot.vouchers.length}
                  </Badge>
                  {lastLot.profileName && (
                    <Badge variant="secondary" className="text-[10px] py-0 px-1.5 h-4 bg-purple-100 text-purple-700 border-0">
                      {lastLot.profileName}
                    </Badge>
                  )}
                  {lastLot.validity && (
                    <Badge variant="secondary" className="text-[10px] py-0 px-1.5 h-4 bg-orange-100 text-orange-700 border-0">
                      ⏱ {lastLot.validity}
                    </Badge>
                  )}
                  {lastLot.price && (
                    <Badge variant="secondary" className="text-[10px] py-0 px-1.5 h-4 bg-green-100 text-green-700 border-0">
                      {lastLot.price} FCFA
                    </Badge>
                  )}
                  {lastLot.vendorName && (
                    <Badge variant="secondary" className="text-[10px] py-0 px-1.5 h-4 bg-gray-100 text-gray-600 border-0">
                      {lastLot.vendorName}
                    </Badge>
                  )}
                  {lastLot.routerName && (
                    <Badge variant="secondary" className="text-[10px] py-0 px-1.5 h-4 bg-gray-100 text-gray-500 border-0">
                      <RouterIcon className="h-2.5 w-2.5 mr-0.5" />{lastLot.routerName}
                    </Badge>
                  )}
                </div>
              </div>

              {/* Dernier lot — barre d’actions */}
              <div className="px-3 py-2 border-b border-gray-100 flex gap-1.5">
                <Button
                  size="sm"
                  className="flex-1 gap-1.5 h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white"
                  onClick={() => handlePrint(lastLot)}
                  disabled={isPrinting}
                >
                  {isPrinting
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Printer className="h-3.5 w-3.5" />}
                  {isPrinting ? "Impression…" : "Imprimer"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className={`gap-1 h-8 px-2.5 transition-colors ${copiedLot ? "border-green-400 text-green-600 bg-green-50" : ""}`}
                  onClick={() => void handleCopyVouchers(lastLot)}
                  title="Copier les vouchers"
                >
                  {copiedLot ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
                <Button size="sm" variant="outline" className="gap-1 h-8 px-2.5" onClick={() => handleExportCsv(lastLot)} title="Exporter .csv">
                  <Table2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 h-8 px-2.5 text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                  onClick={() => setConfirmDeleteLastLot(lastLot)}
                  title="Supprimer ce lot"
                  disabled={isDeletingLastLot}
                >
                  {isDeletingLastLot ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </Button>
              </div>

              {/* ── Liste des codes — masquée sur mobile ── */}
              <div className="hidden sm:block max-h-[420px] overflow-y-auto">
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
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
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

      <DeleteConfirmDialog
        open={!!confirmDeleteLastLot}
        onOpenChange={(o) => { if (!o && !isDeletingLastLot) setConfirmDeleteLastLot(null); }}
        title="Supprimer le lot ?"
        description={<>Le lot <strong className="font-mono">{confirmDeleteLastLot?.comment}</strong> et tous ses vouchers seront définitivement supprimés de MikroTik. Cette action est irréversible.</>}
        onConfirm={() => confirmDeleteLastLot && void handleDeleteLastLot(confirmDeleteLastLot)}
        loading={isDeletingLastLot}
      />
    </div>
  );
}
