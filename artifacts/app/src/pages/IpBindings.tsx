import { useEffect, useMemo, useRef, useState } from "react";
import { useRouterContext } from "@/contexts/RouterContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
import { foldText } from "@/lib/text";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const IP_BINDINGS_CACHE_KEY = "ip-bindings-cache:v1";
const DHCP_LEASES_CACHE_KEY = "dhcp-leases-cache:v1";

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

type ValidityUnit = "h" | "d" | "M" | "y";

interface BindingFormState {
  macAddress: string;
  address: string;
  toAddress: string;
  server: string;
  type: BindingType;
  comment: string;
  /** Username hotspot — ajouté au commentaire (parenthèses) ; si renseigné, la validité fixe ci-dessous est masquée */
  linkedUsername: string;
  /** Durée puis balise [Expire le:…] (date type commentaire) — ex. 30 + Jour = 30 j. (30d), désactivation auto ensuite */
  validityAmount: string;
  validityUnit: ValidityUnit;
  queueUp: string;
  queueDown: string;
  disabled: boolean;
}

interface HotspotUserLite {
  username: string;
  macAddress: string | null;
}

interface HotspotServer {
  name: string;
  interface: string;
  profile: string;
  disabled: boolean;
}

interface DhcpLeaseLite {
  id: string;
  address: string;
  macAddress: string;
}

// Sentinel value used inside the Select component because Radix Select
// does not allow `value=""` on its <SelectItem>. We translate this to an
// empty string before sending the payload to the API.
const SERVER_ALL = "__all__";
function stripStructuralTags(comment: string): string {
  return comment
    .replace(/\s*\[Expire le:[^\]]+\]\s*/g, "")
    .replace(/\s*\[Up:[^\]]+\]\s*/gi, "")
    .replace(/\s*\[Down:[^\]]+\]\s*/gi, "")
    .replace(/\s*\[vnetqu:[^\]]+\]\s*/g, "")
    .replace(/\s*\[vnetqd:[^\]]+\]\s*/g, "")
    .replace(/\s*\[vnetbp:[^\]]+\]\s*/g, "")
    .trim();
}

function extractQueueLimit(comment: string, kind: "up" | "down"): string {
  const modern = kind === "up" ? /\[Up:([^\]]+)\]/i : /\[Down:([^\]]+)\]/i;
  const legacy = kind === "up" ? /\[vnetqu:([^\]]+)\]/ : /\[vnetqd:([^\]]+)\]/;
  return comment.match(modern)?.[1]?.trim() ?? comment.match(legacy)?.[1]?.trim() ?? "";
}

function stripLinkedSuffix(comment: string): string {
  if (/^auto-bypass:user:/i.test(comment.trim())) return "";
  let s = stripStructuralTags(comment);
  return s.replace(/\s*\([^()]+\)\s*$/, "").trim();
}

const VNETEXP_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;

function formatExpirePayload(d: Date): string {
  const m = VNETEXP_MONTHS[d.getMonth()];
  const day = d.getDate();
  const y = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${m}/${day}/${y} ${hh}:${mm}:${ss}`;
}

function extractVnetexpPayload(comment: string): string | null {
  const mNew = comment.match(/\[Expire le:([^\]]+)\]/);
  if (mNew?.[1]?.trim()) return mNew[1].trim();
  return null;
}

function parseVnetexpToMs(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const fromIso = Date.parse(s);
  if (!Number.isNaN(fromIso)) return fromIso;
  const m1 = s.match(/^([a-z]{3})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/i);
  if (!m1) return null;
  const monStr = m1[1].toLowerCase();
  const monthIdx = VNETEXP_MONTHS.findIndex((x) => x === monStr);
  if (monthIdx < 0) return null;
  const day = Number(m1[2]);
  const year = Number(m1[3]);
  const hh = Number(m1[4]);
  const min = Number(m1[5]);
  const sec = m1[6] !== undefined ? Number(m1[6]) : 0;
  if (
    [day, year, hh, min, sec].some((n) => Number.isNaN(n)) ||
    day < 1 ||
    day > 31 ||
    hh > 23 ||
    min > 59 ||
    sec > 59
  ) {
    return null;
  }
  const d = new Date(year, monthIdx, day, hh, min, sec, 0);
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}

function appendVnetexpTag(commentSansTags: string, end: Date): string {
  const t = commentSansTags.trim();
  const payload = formatExpirePayload(end);
  return `${t} [Expire le:${payload}]`.trim();
}

function extractLinkedUsername(comment: string): string {
  const cleaned = stripStructuralTags(comment);
  const legacy = cleaned.match(/^auto-bypass:user:(.+)$/i)?.[1]?.trim();
  if (legacy) return legacy;
  const m = cleaned.match(/\(([^()]+)\)\s*$/);
  return m?.[1]?.trim() ?? "";
}

function buildLinkedComment(base: string, username: string): string {
  const b = stripLinkedSuffix(base);
  const u = username.trim();
  if (!u) return b;
  return b ? `${b} (${u})` : `(${u})`;
}

function validityToMs(n: number, unit: ValidityUnit): number {
  switch (unit) {
    case "h":
      return n * 3600 * 1000;
    case "d":
      return n * 86400 * 1000;
    case "M":
      return n * 30 * 86400 * 1000;
    case "y":
      return n * 365 * 86400 * 1000;
    default:
      return 0;
  }
}

/** Aperçu lisible + équivalent type 30d pour les jours. */
function describeValidityPeriod(n: number, unit: ValidityUnit): string | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  switch (unit) {
    case "h":
      return `${n} heure${n > 1 ? "s" : ""}`;
    case "d":
      return `${n} jour${n > 1 ? "s" : ""}, équivalent ${n}d`;
    case "M":
      return `${n} mois (${n}×30 jours)`;
    case "y":
      return `${n} année${n > 1 ? "s" : ""} (${n}×365 jours)`;
    default:
      return null;
  }
}

const EMPTY_FORM: BindingFormState = {
  macAddress: "",
  address: "",
  toAddress: "",
  server: "",
  type: "bypassed",
  comment: "",
  linkedUsername: "",
  validityAmount: "",
  validityUnit: "d",
  queueUp: "",
  queueDown: "",
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

  // Hotspot servers, lazily loaded the first time the dialog opens for this router.
  const [servers, setServers]                 = useState<HotspotServer[]>([]);
  const [serversLoading, setServersLoading]   = useState(false);
  const [serversError, setServersError]       = useState<string | null>(null);
  // Refs used to harden against router-switch races and double-invocations.
  // - inFlightRouterIdRef stores the router id of the currently in-flight
  //   request (or null when idle), so we can dedupe and reject stale results.
  // - abortRef cancels the in-flight fetch when the active router changes.
  const inFlightRouterIdRef = useRef<number | null>(null);
  const abortRef            = useRef<AbortController | null>(null);

  // Delete confirm
  const [confirmDelete, setConfirmDelete] = useState<IpBinding | null>(null);
  const [deleting, setDeleting]           = useState(false);
  /** ISO conservée à l’édition si l’utilisateur ne saisit pas une nouvelle durée */
  const [preservedStandaloneIso, setPreservedStandaloneIso] = useState<string | null>(null);
  /** `now` = fin = maintenant + durée ; `extend` = fin = fin actuelle + durée (si échéance connue) */
  const [validityScheduleMode, setValidityScheduleMode] = useState<"now" | "extend">("now");

  const [usersLite, setUsersLite] = useState<HotspotUserLite[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);

  const refresh = async (opts: { background?: boolean } = {}) => {
    if (!selectedRouterId) return;
    if (!opts.background) setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/routers/${selectedRouterId}/ip-bindings`);
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { bindings: IpBinding[] };
      setBindings(data.bindings);
      try {
        localStorage.setItem(`${IP_BINDINGS_CACHE_KEY}:${selectedRouterId}`, JSON.stringify(data.bindings));
      } catch {
        // ignore storage issues
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!opts.background) setLoading(false);
    }
  };

  useEffect(() => {
    let hasCached = false;
    if (selectedRouterId) {
      setLoading(true);
      try {
        const raw = localStorage.getItem(`${IP_BINDINGS_CACHE_KEY}:${selectedRouterId}`);
        if (raw) {
          setBindings(JSON.parse(raw) as IpBinding[]);
          hasCached = true;
        } else {
          setBindings([]);
        }
      } catch {
        // ignore invalid cache
        setBindings([]);
      }
    } else {
      setBindings(null);
    }
    if (selectedRouterId) void refresh({ background: hasCached });
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRouterId]);

  const filtered = useMemo(() => {
    if (!bindings) return [];
    if (!search.trim()) return bindings;
    const q = foldText(search);
    return bindings.filter(
      (b) =>
        foldText(b.macAddress).includes(q) ||
        foldText(b.address).includes(q) ||
        foldText(b.toAddress).includes(q) ||
        foldText(b.comment).includes(q),
    );
  }, [bindings, search]);

  const validityPreviewDesc = useMemo(() => {
    const vn = parseInt(form.validityAmount.trim(), 10);
    if (Number.isNaN(vn) || vn <= 0) return null;
    return describeValidityPeriod(vn, form.validityUnit);
  }, [form.validityAmount, form.validityUnit]);

  const preservedEndDisplay = useMemo(() => {
    if (!preservedStandaloneIso) return null;
    const ms = parseVnetexpToMs(preservedStandaloneIso);
    return ms !== null
      ? new Date(ms).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "medium" })
      : preservedStandaloneIso;
  }, [preservedStandaloneIso]);
  const isInitialLoading = loading && (!bindings || bindings.length === 0);
  const isRefreshingList = loading && Boolean(bindings && bindings.length > 0);

  // Lazy-load the hotspot server list once per router-session and reuse it
  // for every dialog open (servers rarely change at runtime).
  //
  // Hardening:
  // - Capture the routerId at request time and verify it still matches before
  //   committing results to state. Prevents stale responses (issued for a
  //   previous router) from polluting the UI after the user switches routers.
  // - Use a ref-based in-flight guard (instead of relying on the async state
  //   update of `serversLoading`) to dedupe rapid-fire opens.
  // - Use AbortController so router-switch cancels the network request.
  const ensureServersLoaded = async () => {
    const routerId = selectedRouterId;
    if (!routerId) return;
    // Already loaded for this router?
    if (servers.length > 0 && !serversError) return;
    // Already loading for this router?
    if (inFlightRouterIdRef.current === routerId) return;

    // Cancel any previous in-flight request (defensive: should already be
    // aborted by the router-change effect, but make sure).
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current            = controller;
    inFlightRouterIdRef.current = routerId;

    setServersLoading(true);
    setServersError(null);
    try {
      const res = await fetch(
        `${BASE}/api/routers/${routerId}/hotspot-servers`,
        { signal: controller.signal },
      );
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { servers: HotspotServer[] };
      // Bail if router changed (or component unmounted) while we awaited.
      if (routerId !== selectedRouterId || controller.signal.aborted) return;
      setServers(data.servers);
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return;
      if (routerId !== selectedRouterId) return;
      setServersError(e instanceof Error ? e.message : String(e));
    } finally {
      if (inFlightRouterIdRef.current === routerId) {
        inFlightRouterIdRef.current = null;
      }
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      // Only flip loading off if we're still the active request.
      if (routerId === selectedRouterId) {
        setServersLoading(false);
      }
    }
  };

  const ensureUsersLoaded = async () => {
    if (!selectedRouterId || usersLoading || usersLite.length > 0) return;
    setUsersLoading(true);
    try {
      const res = await fetch(`${BASE}/api/routers/${selectedRouterId}/users?limit=5000`);
      if (!res.ok) return;
      const data = await res.json() as {
        users?: Array<{ username: string; macAddress: string | null; profile?: string }>;
      };
      setUsersLite(
        (data.users ?? []).map((u) => ({
          username: u.username,
          macAddress: u.macAddress ?? null,
        })),
      );
    } finally {
      setUsersLoading(false);
    }
  };

  const warmDhcpLeasesCache = async (routerId: number) => {
    try {
      const res = await fetch(`${BASE}/api/routers/${routerId}/dhcp-leases`);
      if (!res.ok) return;
      const data = (await res.json()) as { leases?: DhcpLeaseLite[] };
      if (!Array.isArray(data.leases)) return;
      try {
        localStorage.setItem(
          `${DHCP_LEASES_CACHE_KEY}:${routerId}`,
          JSON.stringify({ leases: data.leases, ts: Date.now() }),
        );
      } catch {
        // ignore storage issues
      }
    } catch {
      // best effort prefetch only
    }
  };

  // Reset the server cache and abort any in-flight request when the active
  // router changes (or on unmount).
  useEffect(() => {
    setServers([]);
    setServersError(null);
    setUsersLite([]);
    setUsersLoading(false);
    abortRef.current?.abort();
    abortRef.current            = null;
    inFlightRouterIdRef.current = null;
    setServersLoading(false);
    return () => {
      abortRef.current?.abort();
      abortRef.current            = null;
      inFlightRouterIdRef.current = null;
    };
  }, [selectedRouterId]);

  useEffect(() => {
    if (!selectedRouterId) return;
    // Background warm-up so queue target resolution by MAC has lease data early.
    void warmDhcpLeasesCache(selectedRouterId);
  }, [selectedRouterId]);

  useEffect(() => {
    if (!preservedStandaloneIso && validityScheduleMode === "extend") {
      setValidityScheduleMode("now");
    }
  }, [preservedStandaloneIso, validityScheduleMode]);

  const openAdd = () => {
    setEditing(null);
    setPreservedStandaloneIso(null);
    setValidityScheduleMode("now");
    setForm(EMPTY_FORM);
    setFormOpen(true);
    void ensureServersLoaded();
    void ensureUsersLoaded();
  };

  const openEdit = (b: IpBinding) => {
    const linkedFromComment = extractLinkedUsername(b.comment);
    const expIso = extractVnetexpPayload(b.comment);
    setEditing(b);
    setPreservedStandaloneIso(expIso);
    setValidityScheduleMode(expIso ? "extend" : "now");
    setForm({
      macAddress: b.macAddress,
      address:    b.address,
      toAddress:  b.toAddress,
      // "all" est le placeholder MikroTik pour "tous les serveurs" → on l'efface
      // dans le formulaire pour ne pas l'envoyer comme une valeur explicite.
      server:     b.server === "all" ? "" : b.server,
      type:       b.type,
      comment:    stripLinkedSuffix(b.comment),
      linkedUsername: linkedFromComment,
      validityAmount: "",
      validityUnit: "d",
      queueUp: extractQueueLimit(b.comment, "up"),
      queueDown: extractQueueLimit(b.comment, "down"),
      disabled:   b.disabled,
    });
    setFormOpen(true);
    void ensureServersLoaded();
    void ensureUsersLoaded();
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
    const linkedU = form.linkedUsername.trim();
    setSaving(true);
    try {
      const url = editing
        ? `${BASE}/api/routers/${selectedRouterId}/ip-bindings/${encodeURIComponent(editing.id)}`
        : `${BASE}/api/routers/${selectedRouterId}/ip-bindings`;
      // Sentinel SERVER_ALL = empty string = MikroTik "all"
      const serverPayload = form.server === SERVER_ALL ? "" : form.server.trim();
      const baseText = stripStructuralTags(form.comment.trim());
      let computedComment: string;

      if (linkedU) {
        computedComment = buildLinkedComment(baseText, linkedU);
        computedComment = stripStructuralTags(computedComment);
      } else {
        computedComment = baseText;
        const n = parseInt(form.validityAmount.trim(), 10);
        if (!Number.isNaN(n) && n > 0) {
          const ms = validityToMs(n, form.validityUnit);
          if (ms > 0) {
            let endMs: number;
            if (validityScheduleMode === "extend" && preservedStandaloneIso) {
              const parsed = parseVnetexpToMs(preservedStandaloneIso);
              const curEnd = parsed !== null ? parsed : Date.now();
              endMs = curEnd + ms;
              if (curEnd < Date.now()) {
                endMs = Date.now() + ms;
              }
            } else {
              endMs = Date.now() + ms;
            }
            computedComment = appendVnetexpTag(computedComment, new Date(endMs));
          }
        } else if (editing && preservedStandaloneIso) {
          const keepMs = parseVnetexpToMs(preservedStandaloneIso);
          if (keepMs !== null) {
            computedComment = appendVnetexpTag(computedComment, new Date(keepMs));
          }
        }
      }
      const queueUp = form.queueUp.trim();
      const queueDown = form.queueDown.trim();
      if (queueUp) computedComment = `${computedComment} [Up:${queueUp}]`.trim();
      if (queueDown) computedComment = `${computedComment} [Down:${queueDown}]`.trim();
      const optimisticBinding: IpBinding = {
        id: editing?.id ?? `pending-${Date.now()}`,
        macAddress: mac,
        address: addr,
        toAddress: form.toAddress.trim(),
        server: serverPayload || "all",
        type: form.type,
        comment: computedComment,
        disabled: form.disabled,
      };
      setBindings((cur) => {
        if (editing) {
          return cur ? cur.map((x) => (x.id === editing.id ? optimisticBinding : x)) : [optimisticBinding];
        }
        return cur ? [optimisticBinding, ...cur] : [optimisticBinding];
      });
      setFormOpen(false);
      setSaving(false);
      toast({
        title: editing ? "Liaison modifiée" : "Liaison ajoutée",
        description: mac || addr,
      });
      void (async () => {
        try {
          const res = await fetch(url, {
            method: editing ? "PATCH" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              macAddress: mac,
              address:    addr,
              toAddress:  form.toAddress.trim(),
              server:     serverPayload,  // vide → "all" côté MikroTik
              type:       form.type,
              comment:    computedComment,
              disabled:   form.disabled,
            }),
          });
          if (!res.ok) {
            const err = (await res.json()) as { error?: string };
            throw new Error(err.error ?? `HTTP ${res.status}`);
          }
        } catch (e) {
          toast({
            title: editing ? "Sync modification en échec" : "Sync ajout en échec",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          });
        } finally {
          void refresh({ background: true });
        }
      })();
      return;
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
            Contournement du portail captif (IP-binding MikroTik).{" "}
            <span className="text-gray-600">
              Optionnellement <strong className="font-medium text-gray-700">liez un utilisateur</strong> hotspot.{" "}
              <strong className="font-medium text-gray-700">Sans utilisateur</strong>, indiquez une validité (nombre +{" "}
              Heure, Jour, Mois ou Année) : à l&apos;échéance le bypass est désactivé automatiquement sur le routeur.
            </span>
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {selectedRouterId && (
            <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
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
        {selectedRouterId && isRefreshingList && (
          <Badge variant="outline" className="gap-1.5 text-amber-700 border-amber-200 bg-amber-50">
            <RefreshCw className="h-3 w-3 animate-spin" />
            Mise à jour...
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

      {selectedRouterId && isInitialLoading && (
        <Card>
          <CardContent className="py-6 space-y-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-5/6" />
          </CardContent>
        </Card>
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
        {/*
          Responsive sizing:
          - On small screens, take nearly the full viewport (95vw, max 90vh).
          - On md+ screens, cap at 28rem like before.
          - Form body scrolls vertically when content overflows.
        */}
        <DialogContent className="w-[95vw] max-w-md max-h-[90vh] flex flex-col p-0 sm:p-0">
          <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
            <DialogTitle>{editing ? "Modifier la liaison" : "Nouveau bypass MAC"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Mettez à jour la liaison existante."
                : "Autorisez un appareil à contourner le portail captif en ajoutant son adresse MAC."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-6 py-2 overflow-y-auto flex-1 min-h-0">
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
              <Select
                value={form.server === "" ? SERVER_ALL : form.server}
                onValueChange={(v) => setForm((f) => ({ ...f, server: v === SERVER_ALL ? "" : v }))}
                disabled={serversLoading}
              >
                <SelectTrigger id="server">
                  <SelectValue placeholder="Sélectionner un serveur" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SERVER_ALL}>Tous (all)</SelectItem>
                  {servers.map((s) => (
                    <SelectItem key={s.name} value={s.name}>
                      {s.name}
                      {s.interface ? ` — ${s.interface}` : ""}
                      {s.disabled ? " (désactivé)" : ""}
                    </SelectItem>
                  ))}
                  {/*
                    Si le binding pointe sur un serveur qui n'est pas (ou plus)
                    listé par MikroTik, on ajoute quand même son nom pour éviter
                    de perdre la valeur lors d'une modification.
                  */}
                  {form.server && form.server !== SERVER_ALL &&
                    !servers.some((s) => s.name === form.server) && (
                    <SelectItem value={form.server}>
                      {form.server} (introuvable)
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
              {serversError && (
                <p className="text-xs text-red-500 mt-1">
                  Serveurs indisponibles : {serversError}
                </p>
              )}
              {!serversError && (
                <p className="text-xs text-gray-400 mt-1">
                  Choisissez un serveur Hotspot ou « Tous » pour s&apos;appliquer à toutes les instances.
                </p>
              )}
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
            <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3 sm:p-4 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Utilisateur et validité</h3>
                <p className="text-xs text-gray-600 mt-1">
                  <strong className="font-medium">Utilisateur lié</strong> : le username est ajouté au commentaire.{" "}
                  <strong className="font-medium">Sans utilisateur lié</strong> : saisissez une valeur et choisissez à droite{" "}
                  <strong className="font-medium">Heure</strong>, <strong className="font-medium">Jour</strong>,{" "}
                  <strong className="font-medium">Mois</strong> ou <strong className="font-medium">Année</strong> — ex.{" "}
                  <strong className="font-medium">30</strong> + <strong className="font-medium">Jour</strong> = 30 jours, même durée qu&apos;une notation <code className="text-[10px] bg-white px-1 rounded border">30d</code>
                  . Le système ajoute une balise du type{" "}
                  <code className="text-[10px] bg-white px-1 rounded border">[Expire le:may/30/2026 14:05:00]</code>{" "}
                  (date lisible, comme dans les commentaires hotspot) puis désactive le bypass à l&apos;échéance.
                </p>
              </div>
              <div>
                <Label htmlFor="linked-user">Lier à un utilisateur hotspot (optionnel)</Label>
                <Input
                  id="linked-user"
                  list="hotspot-users-list"
                  value={form.linkedUsername}
                  onChange={(e) => {
                    const username = e.target.value;
                    const matched = usersLite.find((u) => u.username.toLowerCase() === username.trim().toLowerCase());
                    const hasUser = Boolean(username.trim());
                    setForm((f) => ({
                      ...f,
                      linkedUsername: username,
                      type: username.trim() ? "bypassed" : f.type,
                      macAddress: matched?.macAddress ? matched.macAddress : f.macAddress,
                      ...(hasUser
                        ? { validityAmount: "", validityUnit: "d" as ValidityUnit }
                        : {}),
                    }));
                    if (hasUser) setPreservedStandaloneIso(null);
                  }}
                  placeholder="Tapez pour rechercher un username"
                  disabled={usersLoading}
                />
                <datalist id="hotspot-users-list">
                  {usersLite.slice(0, 5000).map((u) => (
                    <option key={u.username} value={u.username}>
                      {u.macAddress ?? ""}
                    </option>
                  ))}
                </datalist>
                <p className="text-xs text-gray-500 mt-1">
                  Le username est ajouté au commentaire entre parenthèses.
                </p>
              </div>
              <div className="rounded-lg border border-sky-100 bg-sky-50/50 p-3 space-y-2">
                <p className="text-[11px] font-medium text-sky-900">Limitation bande passante (queue)</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[11px] text-sky-900/90">Up</Label>
                    <Input
                      className="h-9 mt-1"
                      placeholder="ex: 2M"
                      value={form.queueUp}
                      onChange={(e) => setForm((f) => ({ ...f, queueUp: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] text-sky-900/90">Down</Label>
                    <Input
                      className="h-9 mt-1"
                      placeholder="ex: 10M"
                      value={form.queueDown}
                      onChange={(e) => setForm((f) => ({ ...f, queueDown: e.target.value }))}
                    />
                  </div>
                </div>
                <p className="text-[11px] text-sky-800/90">
                  Appliqué automatiquement côté routeur sur une simple queue liée au bypass (si IP disponible).
                </p>
              </div>
              {!form.linkedUsername.trim() && (
              <div className="rounded-lg border border-amber-100 bg-amber-50/50 p-3 space-y-3">
                <p className="text-[11px] font-medium text-amber-950/90">
                  Bypass sans utilisateur lié — validité et désactivation automatique
                </p>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <Label className="text-amber-900">Durée jusqu&apos;à désactivation auto</Label>
                  {preservedStandaloneIso && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs text-red-700 border-red-200 hover:bg-red-50 shrink-0"
                      onClick={() => {
                        setPreservedStandaloneIso(null);
                        setValidityScheduleMode("now");
                        setForm((f) => ({ ...f, validityAmount: "" }));
                      }}
                    >
                      Supprimer la date d&apos;expiration
                    </Button>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-normal text-amber-900/80">Calcul de la nouvelle échéance</Label>
                  <Select
                    value={validityScheduleMode}
                    onValueChange={(v: "now" | "extend") => {
                      if (v === "extend" && !preservedStandaloneIso) return;
                      setValidityScheduleMode(v);
                    }}
                  >
                    <SelectTrigger className="h-9 bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="now">À partir de maintenant</SelectItem>
                      <SelectItem value="extend" disabled={!preservedStandaloneIso}>
                        Prolonger depuis la fin actuelle
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-amber-800/85">
                    {validityScheduleMode === "extend" && preservedStandaloneIso
                      ? "La durée saisie s’ajoute à la date de fin déjà enregistrée. Si celle-ci est dépassée, le prolongement part d’aujourd’hui."
                      : "La durée saisie est ajoutée à partir de l’instant de l’enregistrement."}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={999}
                    className="w-24 h-9"
                    placeholder="ex: 30"
                    value={form.validityAmount}
                    onChange={(e) => setForm((f) => ({ ...f, validityAmount: e.target.value }))}
                    aria-label="Valeur de la validité"
                  />
                  <Select
                    value={form.validityUnit}
                    onValueChange={(v: ValidityUnit) => setForm((f) => ({ ...f, validityUnit: v }))}
                  >
                    <SelectTrigger className="w-[158px] h-9 bg-white" aria-label="Unité (Heure, Jour, Mois, Année)">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="h">Heure(s)</SelectItem>
                      <SelectItem value="d">Jour(s)</SelectItem>
                      <SelectItem value="M">Mois</SelectItem>
                      <SelectItem value="y">Année(s)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {validityPreviewDesc && (
                  <p className="text-[11px] text-amber-900/95">
                    Aperçu : <strong className="font-medium">{validityPreviewDesc}</strong>. Après cette période, le bypass est coupé automatiquement (synchro serveur).
                  </p>
                )}
                <p className="text-xs text-amber-800/90">
                  Passée l&apos;échéance enregistrée dans le commentaire du routeur, la liaison est désactivée automatiquement.
                </p>
                {preservedStandaloneIso && !form.validityAmount.trim() && preservedEndDisplay && (
                  <p className="text-xs text-amber-900 font-medium">
                    Fin actuelle : {preservedEndDisplay}. Laissez vide pour la conserver, ou saisissez une durée ci-dessus.
                  </p>
                )}
              </div>
              )}
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
