import { useMemo, useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users, ShieldCheck, Plus, Pencil, Trash2, Calendar, Coins,
  CalendarPlus, Power, KeyRound, Loader2, Crown, UserCog, Router as RouterIcon, Search,
  FileCode, ServerCog, Copy, Wifi, Activity, ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription, DialogClose,
} from "@/components/ui/dialog";
import { TicketTemplateEditor } from "@/components/TicketTemplateEditor";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { foldText } from "@/lib/text";
import { useSelectRouterWithPing } from "@/hooks/use-select-router-with-ping";
import {
  routerConnectionStatusShortLabel,
  pingRouterForSuperAdminTenant,
} from "@/lib/router-connection-test";
import { getListRoutersQueryKey } from "@workspace/api-client-react";
import {
  DEFAULT_ROUTER_API_PORT,
  formatMikhmonIpHostForForm,
  formatRouterAddressDisplay,
  parseMikhmonIpHost,
} from "@/lib/router-host-port";

interface RouterRow {
  id: number;
  name: string;
  hotspotName: string | null;
  contact: string | null;
  currency: string | null;
  host: string;
  port: number;
  username: string;
  password: string;
  isActive: boolean;
  ownerAdminId: number;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const VALID_MONTHS = [1, 2, 3, 4, 5, 6, 12] as const;
type ForfaitChoice = "24h" | "unlimited" | `${(typeof VALID_MONTHS)[number]}`;
type CreateForfaitChoice = "0" | ForfaitChoice;

interface AdminRow {
  id: number;
  login: string;
  displayName: string | null;
  isSuperAdmin: boolean;
  /** Défini par GET /api/super/admins — seul l’originel peut supprimer un autre super-admin. */
  canDelete?: boolean;
  isActive: boolean;
  forfaitStartedAt: string | null;
  forfaitEndsAt:   string | null;
  credits: number;
  extraRouterSlots: number;
  routerCount: number;
  passwordPlain: string | null;
  credentialPreview?: {
    login: string | null;
    password: string | null;
    updatedAt: string;
  } | null;
  createdAt: string;
}


const MAX_ROUTER_CURRENCY_LEN = 24;

function normalizeRouterCurrency(raw: string): string {
  const v = raw.trim().toUpperCase().slice(0, MAX_ROUTER_CURRENCY_LEN);
  return v || "FCFA";
}

type RouterFormPayload = {
  name: string;
  hotspotName?: string;
  contact?: string;
  currency: string;
  host: string;
  username: string;
  password: string;
};

const emptyRouterForm: RouterFormPayload = {
  name: "",
  hotspotName: "",
  contact: "",
  currency: "FCFA",
  host: "",
  username: "admin",
  password: "",
};

function fmt(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function forfaitStatus(a: AdminRow, now = Date.now()): { label: string; tone: "success" | "danger" | "warning" | "neutral" } {
  if (a.isSuperAdmin) return { label: "Illimité", tone: "success" };
  if (a.forfaitStartedAt && !a.forfaitEndsAt) return { label: "Illimité", tone: "success" };
  if (!a.forfaitEndsAt) return { label: "Aucun forfait", tone: "danger" };
  const end = new Date(a.forfaitEndsAt).getTime();
  if (end < now) return { label: "Expiré", tone: "danger" };
  const days = Math.ceil((end - now) / 86_400_000);
  if (days <= 7) return { label: `${days} j restant${days > 1 ? "s" : ""}`, tone: "warning" };
  return { label: `${days} jours`, tone: "success" };
}

const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000;

function formatForfaitCountdown(msLeft: number): string {
  const s = Math.max(0, Math.floor(msLeft / 1000));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const hms = `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return days > 0 ? `${days}j ${hms}` : hms;
}

function ForfaitBadge({ admin }: { admin: AdminRow }) {
  const [now, setNow] = useState(() => Date.now());

  const endMs = admin.forfaitEndsAt ? new Date(admin.forfaitEndsAt).getTime() : null;
  const msLeft = endMs != null ? endMs - now : null;
  const isCountdown = msLeft != null && msLeft > 0 && msLeft < SIX_DAYS_MS;

  useEffect(() => {
    if (!isCountdown) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isCountdown]);

  const status = forfaitStatus(admin, now);
  const label = isCountdown && msLeft != null ? formatForfaitCountdown(msLeft) : status.label;
  const tone = isCountdown ? "warning" : status.tone;

  const toneClass =
    tone === "success" ? "bg-emerald-100 text-emerald-700" :
    tone === "warning" ? "bg-amber-100 text-amber-700" :
    tone === "danger"  ? "bg-red-100 text-red-700" :
    "bg-gray-100 text-gray-700";

  return (
    <div className="space-y-1">
      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium tabular-nums ${toneClass}`}>
        {label}
      </span>
      {!admin.isSuperAdmin && admin.forfaitEndsAt && (
        <p className="text-xs text-gray-500">Fin : {fmt(admin.forfaitEndsAt)}</p>
      )}
    </div>
  );
}

export default function SuperAdmins() {
  const { token, isSuperAdmin, connectedUsername } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [createKey, setCreateKey] = useState(0);
  const [createSuperOpen, setCreateSuperOpen] = useState(false);
  const [createSuperKey, setCreateSuperKey] = useState(0);
  const [editing, setEditing] = useState<AdminRow | null>(null);
  const [forfaitTarget, setForfaitTarget] = useState<{ admin: AdminRow; mode: "set" | "extend" } | null>(null);
  const [creditsTarget, setCreditsTarget] = useState<AdminRow | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [adminRouterPanel, setAdminRouterPanel] = useState<AdminRow | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive" | "expired">("all");
  const [deletingAdminId, setDeletingAdminId] = useState<number | null>(null);
  const [confirmDeleteAdmin, setConfirmDeleteAdmin] = useState<AdminRow | null>(null);
  const [templateTarget, setTemplateTarget] = useState<AdminRow | null>(null);
  const [showCopyOwnVendors, setShowCopyOwnVendors] = useState(false);

  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  const { data: adminsPayload, isLoading } = useQuery<{
    admins: AdminRow[];
    originalSuperAdminId: number | null;
    viewerIsOriginalSuperAdmin: boolean;
  }>({
    queryKey: ["super", "admins"],
    enabled: !!token && isSuperAdmin,
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/super/admins`, { headers });
      if (!r.ok) throw new Error((await r.json()).error ?? "Erreur de chargement");
      const data = await r.json();
      if (Array.isArray(data)) {
        return { admins: data as AdminRow[], originalSuperAdminId: null, viewerIsOriginalSuperAdmin: false };
      }
      return {
        admins: (data?.admins ?? []) as AdminRow[],
        originalSuperAdminId: typeof data?.originalSuperAdminId === "number" ? data.originalSuperAdminId : null,
        viewerIsOriginalSuperAdmin: data?.viewerIsOriginalSuperAdmin === true,
      };
    },
  });
  const admins = adminsPayload?.admins ?? [];
  const originalSuperAdminId = adminsPayload?.originalSuperAdminId ?? null;
  const viewerIsOriginalSuperAdmin = adminsPayload?.viewerIsOriginalSuperAdmin === true;

  const viewerAdminId = useMemo(() => {
    if (!connectedUsername) return null;
    const login = connectedUsername.trim().toLowerCase();
    return admins.find((a) => a.login.trim().toLowerCase() === login)?.id ?? null;
  }, [admins, connectedUsername]);

  const canDeleteAdmin = (a: AdminRow): boolean => {
    if (typeof a.canDelete === "boolean") return a.canDelete;
    if (viewerAdminId != null && a.id === viewerAdminId) return false;
    if (!a.isSuperAdmin) return true;
    return (
      viewerIsOriginalSuperAdmin &&
      originalSuperAdminId != null &&
      a.id !== originalSuperAdminId
    );
  };

  const selfSuperAdmin = useMemo(() => admins.find((a) => a.isSuperAdmin), [admins]);
  const canCopyVendorsBetweenOwnRouters = !!selfSuperAdmin && selfSuperAdmin.routerCount >= 2;

  const refresh = () => qc.invalidateQueries({ queryKey: ["super", "admins"] });

  const handleErr = (err: unknown) => {
    toast({
      title: "Erreur",
      description: err instanceof Error ? err.message : "Opération échouée",
      variant: "destructive",
    });
  };

  /* ---------- mutations ---------- */
  const createM = useMutation({
    mutationFn: async (v: { login: string; password: string; displayName?: string; forfaitMonths?: number; forfaitTest24h?: boolean; forfaitUnlimited?: boolean }) => {
      const r = await fetch(`${BASE}/api/super/admins`, { method: "POST", headers, body: JSON.stringify(v) });
      if (!r.ok) throw new Error((await r.json()).error ?? "Création impossible");
      return r.json();
    },
    onSuccess: () => { setCreateOpen(false); refresh(); toast({ title: "Administrateur créé" }); },
    onError: handleErr,
  });

  const createSuperM = useMutation({
    mutationFn: async (v: { login: string; password: string; displayName?: string; verificationCode?: string }) => {
      const r = await fetch(`${BASE}/api/super/admins`, { method: "POST", headers, body: JSON.stringify({ ...v, isSuperAdmin: true }) });
      if (!r.ok) throw new Error((await r.json()).error ?? "Création impossible");
      return r.json();
    },
    onSuccess: () => { setCreateSuperOpen(false); refresh(); toast({ title: "Super administrateur créé" }); },
    onError: handleErr,
  });

  const editM = useMutation({
    mutationFn: async (v: { id: number; login?: string; displayName?: string | null; password?: string; isActive?: boolean }) => {
      const { id, ...body } = v;
      const r = await fetch(`${BASE}/api/super/admins/${id}`, { method: "PATCH", headers, body: JSON.stringify(body) });
      if (!r.ok) throw new Error((await r.json()).error ?? "Mise à jour impossible");
      return r.json();
    },
    onSuccess: () => { setEditing(null); refresh(); toast({ title: "Administrateur mis à jour" }); },
    onError: handleErr,
  });

  const deleteM = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`${BASE}/api/super/admins/${id}`, { method: "DELETE", headers });
      if (!r.ok) throw new Error((await r.json()).error ?? "Suppression impossible");
    },
    onError: handleErr,
  });

  const handleDeleteAdmin = async (admin: AdminRow) => {
    if (deletingAdminId !== null) return;
    setDeletingAdminId(admin.id);
    try {
      await deleteM.mutateAsync(admin.id);
      qc.setQueryData<{
        admins: AdminRow[];
        originalSuperAdminId: number | null;
        viewerIsOriginalSuperAdmin: boolean;
      }>(
        ["super", "admins"],
        (prev) =>
          prev
            ? { ...prev, admins: prev.admins.filter((a) => a.id !== admin.id) }
            : prev,
      );
      refresh();
      setConfirmDeleteAdmin(null);
      toast({
        title: admin.isSuperAdmin ? "Super administrateur supprimé" : "Administrateur supprimé",
      });
    } catch {
      // Error toast handled by mutation onError (handleErr).
    } finally {
      setDeletingAdminId(null);
    }
  };

  const forfaitM = useMutation({
    mutationFn: async (v: { id: number; duration: ForfaitChoice; mode: "set" | "extend" }) => {
      const url = v.mode === "extend"
        ? `${BASE}/api/super/admins/${v.id}/forfait/extend`
        : `${BASE}/api/super/admins/${v.id}/forfait`;
      const payload = v.duration === "unlimited"
        ? { unlimited: true }
        : v.duration === "24h"
        ? { test24h: true }
        : { months: Number(v.duration) };
      const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
      if (!r.ok) throw new Error((await r.json()).error ?? "Forfait non mis à jour");
      return r.json();
    },
    onSuccess: () => { setForfaitTarget(null); refresh(); toast({ title: "Forfait mis à jour" }); },
    onError: handleErr,
  });

  const creditsM = useMutation({
    mutationFn: async (v: { id: number; delta: number }) => {
      const r = await fetch(`${BASE}/api/super/admins/${v.id}/credits`, {
        method: "POST", headers, body: JSON.stringify({ delta: v.delta }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Mise à jour des crédits impossible");
      return r.json();
    },
    onSuccess: () => { setCreditsTarget(null); refresh(); toast({ title: "Crédits mis à jour" }); },
    onError: handleErr,
  });


  // Self-service: super-admin (or any admin) updates their own login/password.
  const accountM = useMutation({
    mutationFn: async (v: { login?: string; password?: string }) => {
      const body: Record<string, string> = {};
      if (v.login) body.login = v.login;
      if (v.password) body.password = v.password;
      const r = await fetch(`${BASE}/api/admin/credentials`, {
        method: "PUT", headers, body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Mise à jour impossible");
      return r.json();
    },
    onSuccess: () => {
      setAccountOpen(false);
      refresh();
      toast({
        title: "Identifiants mis à jour",
        description: "Vos nouveaux identifiants seront utilisés à la prochaine connexion.",
      });
    },
    onError: handleErr,
  });

  /* ---------- gating ---------- */
  if (!isSuperAdmin) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Accès réservé au Super Administrateur.
        </div>
      </div>
    );
  }

  const filteredAdmins = useMemo(() => {
    const q = foldText(search).trim();
    return admins.filter((a) => {
      if (statusFilter === "active" && !a.isActive) return false;
      if (statusFilter === "inactive" && a.isActive) return false;
      if (statusFilter === "expired") {
        if (a.isSuperAdmin || !a.forfaitEndsAt) return false;
        if (new Date(a.forfaitEndsAt).getTime() >= Date.now()) return false;
      }
      if (!q) return true;
      const hay = foldText(`${a.login} ${a.displayName ?? ""}`);
      return hay.includes(q);
    });
  }, [admins, search, statusFilter]);

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-amber-100 flex items-center justify-center">
            <Crown className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-gray-900">Super Administrateurs</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setAccountOpen(true)} className="gap-2" title="Modifier mes identifiants">
            <UserCog className="h-4 w-4" />
            <span className="hidden sm:inline">Mon compte</span>
          </Button>
          <Button
            variant="outline"
            className="gap-2 text-emerald-700 border-emerald-200 hover:bg-emerald-50"
            disabled={!canCopyVendorsBetweenOwnRouters}
            title={
              !selfSuperAdmin
                ? "Compte super-admin introuvable dans la liste"
                : selfSuperAdmin.routerCount < 2
                  ? "Au moins deux routeurs sur votre compte sont nécessaires pour copier des vendeurs."
                  : "Copier les vendeurs d'un de vos routeurs vers un autre"
            }
            onClick={() => setShowCopyOwnVendors(true)}
          >
            <Users className="h-4 w-4" />
            <span className="hidden sm:inline">Mes vendeurs</span>
            <span className="sm:hidden">Vendeurs</span>
          </Button>
          {viewerIsOriginalSuperAdmin && (
          <Button
            onClick={() => { setCreateSuperKey((k) => k + 1); setCreateSuperOpen(true); }}
            className="gap-2 bg-orange-500 hover:bg-orange-600 text-white"
          >
            <ShieldCheck className="h-4 w-4" />
            <span className="hidden sm:inline">Nouveau super admin</span>
            <span className="sm:hidden">Super admin</span>
          </Button>
          )}
          <Button onClick={() => { setCreateKey((k) => k + 1); setCreateOpen(true); }} className="gap-2">
            <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Nouvel</span> admin
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher un admin..." className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
          <SelectTrigger className="w-full sm:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous</SelectItem>
            <SelectItem value="active">Actifs</SelectItem>
            <SelectItem value="inactive">Inactifs</SelectItem>
            <SelectItem value="expired">Expirés</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table card */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-3">
            <Skeleton className="h-5 w-40 mx-auto" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : filteredAdmins.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            Aucun administrateur pour ce filtre.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="text-left px-4 py-3">Compte</th>
                  <th className="text-left px-4 py-3">Statut</th>
                  <th className="text-left px-4 py-3">Forfait</th>
                  <th className="text-right px-4 py-3">Crédits</th>
                  <th className="text-right px-4 py-3">Routeurs</th>
                  <th className="text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredAdmins.map((a) => {
                  const limit = 5 + a.extraRouterSlots;
                  const isExpired = !a.isSuperAdmin && !!a.forfaitEndsAt && new Date(a.forfaitEndsAt).getTime() < Date.now();
                  const isExpiredAndInactive = isExpired && !a.isActive;
                  return (
                    <tr key={a.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {a.isSuperAdmin ? (
                            <ShieldCheck className="h-4 w-4 text-amber-600 flex-shrink-0" />
                          ) : (
                            <Users className="h-4 w-4 text-blue-600 flex-shrink-0" />
                          )}
                          <div>
                            {a.isSuperAdmin ? (
                              <button
                                type="button"
                                className="font-semibold text-amber-900 hover:text-amber-950 hover:underline text-left"
                                onClick={() => setAdminRouterPanel(a)}
                                title="Voir vos routeurs"
                              >
                                {a.displayName || a.login}
                              </button>
                            ) : null}
                            {a.isSuperAdmin && originalSuperAdminId === a.id && (
                              <span className="inline-flex text-[10px] font-semibold bg-amber-100 text-amber-800 border border-amber-200 rounded-full px-2 py-0.5 mt-0.5">
                                Originel
                              </span>
                            )}
                            {!a.isSuperAdmin && (
                              <button
                                type="button"
                                className="font-semibold text-blue-700 hover:text-blue-900 hover:underline text-left"
                                onClick={() => setAdminRouterPanel(a)}
                                title="Voir les routeurs de cet admin"
                              >
                                {a.displayName || a.login}
                              </button>
                            )}

                            {a.credentialPreview && (Date.now() - new Date(a.credentialPreview.updatedAt).getTime()) < 86_400_000 && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-orange-100 text-orange-700 border border-orange-300 rounded-full px-2 py-0.5 mt-0.5">
                                <span className="h-1.5 w-1.5 rounded-full bg-orange-500 animate-pulse inline-block" />
                                Identifiants modifiés
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant={a.isActive ? "default" : "destructive"} className={a.isActive ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100" : ""}>
                            {a.isActive ? "Actif" : "Désactivé"}
                          </Badge>
                          {isExpiredAndInactive && (
                            <Badge className="bg-red-600 text-white hover:bg-red-600">
                              Expiré + Inactif
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <ForfaitBadge admin={a} />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {a.isSuperAdmin ? <span className="text-gray-400">∞</span> : a.credits}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span className="font-medium">{a.routerCount}</span>
                        <span className="text-gray-400">/{a.isSuperAdmin ? "∞" : limit}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {a.isSuperAdmin && (
                            <Button
                              size="icon"
                              variant="ghost"
                              title="Gérer mes routeurs"
                              onClick={() => setAdminRouterPanel(a)}
                            >
                              <RouterIcon className="h-4 w-4 text-amber-700" />
                            </Button>
                          )}
                          {!a.isSuperAdmin && (
                            <>
                              <Button
                                size="icon"
                                variant="ghost"
                                title={a.isActive ? "Désactiver" : "Activer"}
                                onClick={() => editM.mutate({ id: a.id, isActive: !a.isActive })}
                              >
                                <Power className={`h-4 w-4 ${a.isActive ? "text-emerald-600" : "text-gray-500"}`} />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                title="Gérer les routeurs de cet admin"
                                onClick={() => setAdminRouterPanel(a)}
                              >
                                <RouterIcon className="h-4 w-4 text-blue-600" />
                              </Button>
                              <Button size="icon" variant="ghost" title="Définir le forfait"
                                onClick={() => setForfaitTarget({ admin: a, mode: "set" })}>
                                <Calendar className="h-4 w-4" />
                              </Button>
                              <Button size="icon" variant="ghost" title="Prolonger le forfait"
                                onClick={() => setForfaitTarget({ admin: a, mode: "extend" })}>
                                <CalendarPlus className="h-4 w-4" />
                              </Button>
                              <Button size="icon" variant="ghost" title="Crédits"
                                onClick={() => setCreditsTarget(a)}>
                                <Coins className="h-4 w-4" />
                              </Button>
                              <Button size="icon" variant="ghost" title="Modèle de ticket"
                                onClick={() => setTemplateTarget(a)}>
                                <FileCode className="h-4 w-4 text-violet-600" />
                              </Button>
                            </>
                          )}
                          <Button size="icon" variant="ghost" title="Modifier"
                            onClick={() => setEditing(a)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {canDeleteAdmin(a) && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                              title={a.isSuperAdmin ? "Supprimer ce super administrateur" : "Supprimer"}
                              onClick={() => setConfirmDeleteAdmin(a)}
                              disabled={deletingAdminId !== null}
                            >
                              {deletingAdminId === a.id
                                ? <Loader2 className="h-4 w-4 animate-spin text-red-600" />
                                : <Trash2 className="h-4 w-4 text-red-600" />}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <DeleteConfirmDialog
        open={!!confirmDeleteAdmin}
        onOpenChange={(open) => { if (!open && deletingAdminId === null) setConfirmDeleteAdmin(null); }}
        title={
          confirmDeleteAdmin?.isSuperAdmin
            ? "Supprimer ce super administrateur ?"
            : "Supprimer cet administrateur ?"
        }
        description={
          confirmDeleteAdmin ? (
            <>
              <span className="font-medium text-foreground">
                {confirmDeleteAdmin.displayName || confirmDeleteAdmin.login}
              </span>
              {confirmDeleteAdmin.isSuperAdmin ? (
                <span className="block mt-2 text-muted-foreground">
                  Ce compte super administrateur (non originel) sera définitivement supprimé avec ses routeurs et
                  données associées. Action réservée au super administrateur originel.
                </span>
              ) : (
                <span className="block mt-2 text-muted-foreground">
                  Toutes les données de cet administrateur (routeurs, vendeurs, vouchers…) seront supprimées.
                </span>
              )}
            </>
          ) : null
        }
        loading={deletingAdminId !== null}
        onConfirm={() => {
          if (confirmDeleteAdmin) void handleDeleteAdmin(confirmDeleteAdmin);
        }}
      />

      {/* Create super admin dialog */}
      {viewerIsOriginalSuperAdmin && (
      <CreateSuperAdminDialog key={createSuperKey} open={createSuperOpen} onClose={() => setCreateSuperOpen(false)} onSubmit={(v) => createSuperM.mutate(v)} pending={createSuperM.isPending} />
      )}

      {/* Create dialog */}
      <CreateDialog key={createKey} open={createOpen} onClose={() => setCreateOpen(false)} onSubmit={(v) => createM.mutate(v)} pending={createM.isPending} />

      {/* Edit dialog */}
      {editing && (
        <EditDialog
          admin={editing}
          onClose={() => setEditing(null)}
          onSubmit={(v) => editM.mutate({ id: editing.id, ...v })}
          pending={editM.isPending}
        />
      )}

      {/* Forfait dialog */}
      {forfaitTarget && (
        <ForfaitDialog
          admin={forfaitTarget.admin}
          mode={forfaitTarget.mode}
          onClose={() => setForfaitTarget(null)}
          onSubmit={(duration) => forfaitM.mutate({ id: forfaitTarget.admin.id, duration, mode: forfaitTarget.mode })}
          pending={forfaitM.isPending}
        />
      )}

      {/* Credits dialog */}
      {creditsTarget && (
        <CreditsDialog
          admin={creditsTarget}
          onClose={() => setCreditsTarget(null)}
          onSubmit={(delta) => creditsM.mutate({ id: creditsTarget.id, delta })}
          pending={creditsM.isPending}
        />
      )}

      {adminRouterPanel && (
        <AdminRoutersSheet
          admin={adminRouterPanel}
          onClose={() => { setAdminRouterPanel(null); refresh(); }}
        />
      )}

      {showCopyOwnVendors && selfSuperAdmin && (
        <CopyOwnVendorsDialog
          myAdminId={selfSuperAdmin.id}
          onClose={() => setShowCopyOwnVendors(false)}
        />
      )}

      {templateTarget && token && (
        <TicketTemplateEditor
          key={templateTarget.id}
          layout="dialog"
          isolatedScope
          title={`Modèle de ticket — ${templateTarget.displayName || templateTarget.login}`}
          subtitle="Même éditeur que la page Modèle de ticket : les changements sont enregistrés sur le compte de cet administrateur (pas sur le vôtre)."
          loadPath={`/api/super/admins/${templateTarget.id}/ticket-template`}
          savePath={`/api/super/admins/${templateTarget.id}/ticket-template`}
          authHeaders={{ Authorization: `Bearer ${token}` }}
          onClose={() => { setTemplateTarget(null); refresh(); }}
          onSaved={() => refresh()}
        />
      )}

      {/* My credentials (self) dialog */}
      <AccountDialog
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        onSubmit={(v) => accountM.mutate(v)}
        pending={accountM.isPending}
        currentAdmin={admins.find((a) => a.isSuperAdmin) ?? null}
      />
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   AdminRoutersSheet — panneau latéral de gestion des routeurs d'un admin
   ══════════════════════════════════════════════════════ */

function AdminRoutersSheet({ admin, onClose }: { admin: AdminRow; onClose: () => void }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  const { selectWithPing, pingingId: connectingId } = useSelectRouterWithPing();

  const panelQueryKey = ["super", "admin-routers-panel", admin.id] as const;
  const routerLimit = admin.isSuperAdmin ? null : 5 + admin.extraRouterSlots;

  const [panelView, setPanelView] = useState<"list" | "form">("list");
  const [editingRouter, setEditingRouter] = useState<RouterRow | null>(null);
  const [form, setForm] = useState<RouterFormPayload>(emptyRouterForm);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [showCopyVendors, setShowCopyVendors] = useState(false);
  const [showCopyRouter, setShowCopyRouter] = useState(false);
  const [pingingIds, setPingingIds] = useState<Set<number>>(new Set());
  const [pingResults, setPingResults] = useState<Record<number, { success: boolean; message: string }>>({});

  const { data: routers = [], isLoading } = useQuery<RouterRow[]>({
    queryKey: panelQueryKey,
    enabled: !!token,
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/super/admins/${admin.id}/routers`, { headers });
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Chargement des routeurs impossible");
      }
      return r.json();
    },
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: panelQueryKey });
    void qc.invalidateQueries({ queryKey: ["super", "admins"] });
    void qc.invalidateQueries({ queryKey: getListRoutersQueryKey() });
  };

  const buildRouterBody = (p: RouterFormPayload, forEdit = false) => {
    const body: Record<string, unknown> = {
      name: p.name,
      hotspotName: p.hotspotName?.trim() || undefined,
      contact: p.contact?.trim() || undefined,
      currency: normalizeRouterCurrency(p.currency),
      ...parseMikhmonIpHost(p.host),
      username: p.username,
    };
    if (!forEdit || p.password.trim()) {
      body.password = p.password.trim();
    }
    return body;
  };

  const createM = useMutation({
    mutationFn: async (p: RouterFormPayload) => {
      const r = await fetch(`${BASE}/api/super/admins/${admin.id}/routers`, {
        method: "POST",
        headers,
        body: JSON.stringify(buildRouterBody(p)),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Création impossible");
      return r.json();
    },
    onSuccess: () => {
      setPanelView("list");
      setEditingRouter(null);
      setForm(emptyRouterForm);
      invalidate();
      toast({ title: "Routeur ajouté", description: `Rattaché à ${admin.displayName || admin.login}.` });
    },
    onError: (e: Error) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const editM = useMutation({
    mutationFn: async (p: RouterFormPayload & { id: number }) => {
      const { id, ...rest } = p;
      const r = await fetch(`${BASE}/api/super/admins/${admin.id}/routers/${id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(buildRouterBody(rest, true)),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Mise à jour impossible");
      return r.json();
    },
    onSuccess: () => {
      setPanelView("list");
      setEditingRouter(null);
      invalidate();
      toast({ title: "Routeur mis à jour" });
    },
    onError: (e: Error) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const openCreateForm = () => {
    setEditingRouter(null);
    setForm(emptyRouterForm);
    setPanelView("form");
  };

  const openEditForm = (r: RouterRow) => {
    setEditingRouter(r);
    setForm({
      name: r.name,
      hotspotName: r.hotspotName ?? "",
      contact: r.contact ?? "",
      currency: normalizeRouterCurrency(r.currency ?? "FCFA"),
      host: formatMikhmonIpHostForForm(r.host, r.port),
      username: r.username,
      password: r.password ?? "",
    });
    setPanelView("form");
  };

  const handlePing = async (r: RouterRow) => {
    if (pingingIds.has(r.id)) return;
    setPingingIds((s) => new Set(s).add(r.id));
    try {
      const data = await pingRouterForSuperAdminTenant(admin.id, r.id, token);
      setPingResults((prev) => ({
        ...prev,
        [r.id]: { success: data.success, message: data.message },
      }));
    } catch {
      setPingResults((prev) => ({
        ...prev,
        [r.id]: { success: false, message: "Erreur réseau" },
      }));
    } finally {
      setPingingIds((s) => {
        const n = new Set(s);
        n.delete(r.id);
        return n;
      });
    }
  };

  const deleteRouter = async (r: RouterRow) => {
    if (!confirm(`Supprimer le routeur « ${r.name} » et toutes ses données ?`)) return;
    setDeletingId(r.id);
    try {
      const res = await fetch(`${BASE}/api/super/admins/${admin.id}/routers/${r.id}`, { method: "DELETE", headers });
      if (!res.ok) throw new Error((await res.json()).error ?? "Suppression impossible");
      invalidate();
      toast({ title: "Routeur supprimé" });
    } catch (e) {
      toast({
        title: "Erreur",
        description: e instanceof Error ? e.message : "Opération échouée",
        variant: "destructive",
      });
    } finally {
      setDeletingId(null);
    }
  };

  const formPending = createM.isPending || editM.isPending;
  const canSubmitForm =
    !formPending
    && !!form.name.trim()
    && !!form.host.trim()
    && !!form.username.trim()
    && (editingRouter ? true : form.password.length >= 1);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmitForm) return;
    if (editingRouter) {
      editM.mutate({ id: editingRouter.id, ...form, name: form.name.trim(), host: form.host.trim(), username: form.username.trim() });
    } else {
      createM.mutate({ ...form, name: form.name.trim(), host: form.host.trim(), username: form.username.trim() });
    }
  };

  const atRouterLimit =
    routerLimit != null && routers.length >= routerLimit && panelView === "list";

  return (
    <>
      <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="max-w-2xl w-[calc(100vw-2rem)] flex flex-col gap-0 p-0 max-h-[88vh] overflow-hidden">
          <DialogHeader className="px-4 py-3 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2 text-sm sm:text-base">
              {panelView === "form" ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => { setPanelView("list"); setEditingRouter(null); }}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              ) : (
                <ServerCog className="h-4 w-4 text-blue-600 shrink-0" />
              )}
              <span className="truncate">
                {panelView === "form"
                  ? (editingRouter ? `Modifier — ${editingRouter.name}` : "Ajouter un routeur")
                  : `Routeurs — ${admin.displayName || admin.login}`}
              </span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              {panelView === "form"
                ? `Enregistrement sur le compte ${admin.displayName || admin.login} (API super-admin).`
                : (
                  <>
                    {routers.length} routeur{routers.length !== 1 ? "s" : ""}
                    {admin.isSuperAdmin ? " · Limite illimitée" : ` · Limite ${routerLimit}`}
                    {atRouterLimit ? " · Plafond atteint (crédits requis pour extension auto)" : ""}
                  </>
                )}
            </DialogDescription>
          </DialogHeader>

          {panelView === "form" ? (
            <form onSubmit={handleFormSubmit} className="flex flex-col min-h-0 flex-1">
              <div className="overflow-y-auto px-4 py-3 space-y-3">
                <div>
                  <Label>Nom <span className="text-red-500">*</span></Label>
                  <Input className="mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label>Nom du Wifi</Label>
                    <Input className="mt-1" value={form.hotspotName} onChange={(e) => setForm({ ...form, hotspotName: e.target.value })} />
                  </div>
                  <div>
                    <Label>Contact</Label>
                    <Input className="mt-1" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
                  </div>
                </div>
                <div>
                  <Label>Devise</Label>
                  <Input
                    className="mt-1 font-mono uppercase"
                    value={form.currency}
                    onChange={(e) => setForm({ ...form, currency: normalizeRouterCurrency(e.target.value) })}
                  />
                </div>
                <div>
                  <Label>IP <span className="text-red-500">*</span></Label>
                  <Input
                    className="mt-1 font-mono"
                    value={form.host}
                    onChange={(e) => setForm({ ...form, host: e.target.value })}
                    placeholder="192.168.88.1 ou vpn.nanotechvpn.com:60006"
                    required
                  />
                  <p className="text-xs text-gray-400 mt-0.5">
                    Mikhmon iphost — port {DEFAULT_ROUTER_API_PORT} par défaut, sinon <span className="font-mono">hôte:port</span>.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Utilisateur <span className="text-red-500">*</span></Label>
                    <Input className="mt-1" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
                  </div>
                  <div>
                    <Label>Mot de passe <span className="text-red-500">*</span></Label>
                    <PasswordInput
                      className="mt-1"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      placeholder={editingRouter ? "Laisser vide = inchangé" : ""}
                    />
                  </div>
                </div>
              </div>
              <DialogFooter className="px-4 py-3 border-t gap-2 sm:gap-0">
                <Button type="button" variant="outline" onClick={() => { setPanelView("list"); setEditingRouter(null); }}>
                  Annuler
                </Button>
                <Button type="submit" disabled={!canSubmitForm}>
                  {formPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {editingRouter ? "Enregistrer" : "Ajouter"}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <>
              <div className="flex items-center justify-between px-3 py-2 border-b shrink-0 gap-2 flex-wrap">
                <span className="text-xs text-gray-500 shrink-0">
                  {isLoading ? "Chargement…" : `${routers.length} routeur${routers.length !== 1 ? "s" : ""}`}
                </span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs gap-1 text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                    disabled={routers.length === 0}
                    onClick={() => setShowCopyVendors(true)}
                  >
                    <Users className="h-3 w-3" /> Copier vendeurs
                  </Button>
                  <Button size="sm" variant="accentOutline" className="gap-1 h-7" onClick={() => setShowCopyRouter(true)}>
                    <Copy className="h-3 w-3" /> Copier routeur
                  </Button>
                  <Button
                    size="sm"
                    className="gap-1 h-7"
                    onClick={openCreateForm}
                    disabled={atRouterLimit}
                    title={atRouterLimit ? "Limite de routeurs atteinte pour cet admin" : undefined}
                  >
                    <Plus className="h-3 w-3" /> Ajouter
                  </Button>
                </div>
              </div>

              <div className="overflow-y-auto px-3 py-2 space-y-1.5" style={{ scrollbarGutter: "stable" }}>
                {isLoading && (
                  <div className="space-y-1.5 py-1">
                    <Skeleton className="h-14 w-full rounded-xl" />
                    <Skeleton className="h-14 w-full rounded-xl" />
                  </div>
                )}
                {!isLoading && routers.length === 0 && (
                  <div className="py-10 text-center text-sm text-gray-400">
                    Aucun routeur pour cet admin. Cliquez sur « Ajouter » pour en créer un.
                  </div>
                )}
                {routers.map((r) => {
                  const ownerId = r.ownerAdminId ?? admin.id;
                  const pingResult = pingResults[r.id];
                  const pingOk = pingResult?.success === true;
                  const hasPing = r.id in pingResults;
                  const isPinging = pingingIds.has(r.id);
                  const isConnecting = connectingId === r.id;
                  return (
                    <div
                      key={r.id}
                      className="flex items-center gap-2 bg-white rounded-xl border border-gray-100 shadow-sm px-3 py-2 hover:shadow-md hover:border-blue-200 transition-all cursor-pointer group"
                      title="Cliquer pour se connecter à ce routeur"
                      onClick={() =>
                        void selectWithPing(r.id, {
                          routerData: {
                            id: r.id,
                            name: r.name,
                            ownerAdminId: ownerId,
                            host: r.host,
                            port: r.port,
                            hotspotName: r.hotspotName ?? null,
                            contact: r.contact ?? null,
                            currency: r.currency ?? null,
                          },
                        })
                      }
                    >
                      <div className="p-1.5 rounded-lg bg-blue-50 shrink-0">
                        {isConnecting ? <Loader2 className="h-4 w-4 animate-spin text-blue-400" /> : <Wifi className="h-4 w-4 text-blue-500" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1 flex-wrap">
                          <p className="font-bold text-xs text-gray-900 truncate uppercase tracking-wide">{r.name}</p>
                          {hasPing && pingResult && (
                            <span
                              className={`inline-flex max-w-[12rem] items-center rounded-full px-1 min-h-3.5 text-[9px] font-semibold border shrink-0 truncate ${
                                pingOk ? "text-emerald-600 border-emerald-200 bg-emerald-50" : "text-red-600 border-red-200 bg-red-50"
                              }`}
                            >
                              {routerConnectionStatusShortLabel(pingResult)}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-gray-400 leading-tight truncate font-mono">{formatRouterAddressDisplay(r.host, r.port)}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                        {!isConnecting && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 rounded-full text-blue-500 hover:text-blue-600 hover:bg-blue-50 border border-blue-200"
                            title="Tester la connexion"
                            disabled={isPinging}
                            onClick={(e) => { e.stopPropagation(); void handlePing(r); }}
                          >
                            {isPinging ? <Loader2 className="h-3 w-3 animate-spin" /> : <Activity className="h-3 w-3" />}
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 border border-slate-200"
                          title="Modifier"
                          onClick={(e) => { e.stopPropagation(); openEditForm(r); }}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 rounded-full text-red-500 hover:text-red-600 hover:bg-red-50 border border-red-200"
                          title="Supprimer"
                          disabled={deletingId !== null}
                          onClick={(e) => { e.stopPropagation(); void deleteRouter(r); }}
                        >
                          {deletingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {showCopyVendors && (
        <CopyVendorsDialog admin={admin} adminRouters={routers} onClose={() => setShowCopyVendors(false)} />
      )}

      {showCopyRouter && (
        <CopyRouterDialog
          targetAdmin={admin}
          existingRouterIds={routers.map((r) => r.id)}
          onClose={() => setShowCopyRouter(false)}
          onCopy={(r) => {
            setShowCopyRouter(false);
            createM.mutate({
              name: r.name,
              hotspotName: r.hotspotName ?? "",
              contact: r.contact ?? "",
              currency: normalizeRouterCurrency(r.currency ?? "FCFA"),
              host: formatMikhmonIpHostForForm(r.host, r.port),
              username: r.username,
              password: r.password,
            });
          }}
        />
      )}
    </>
  );
}

/* ══════════════════════════════════════════════════════
   CopyRouterDialog — sélectionner un routeur existant pour le dupliquer
   ══════════════════════════════════════════════════════ */
interface AllRouterRow extends RouterRow {
  ownerLogin: string | null;
  ownerDisplayName: string | null;
}

function CopyRouterDialog({
  targetAdmin,
  existingRouterIds,
  onClose,
  onCopy,
}: {
  targetAdmin: AdminRow;
  existingRouterIds: number[];
  onClose: () => void;
  onCopy: (r: AllRouterRow) => void;
}) {
  const { token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [search, setSearch] = useState("");

  const { data: allRouters = [], isLoading } = useQuery<AllRouterRow[]>({
    queryKey: ["super", "all-routers"],
    enabled: !!token,
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/super/all-routers`, { headers });
      if (!r.ok) throw new Error("Impossible de charger les routeurs");
      return r.json();
    },
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return allRouters.filter((r) => {
      if (r.ownerAdminId === targetAdmin.id) return false; // déjà propriétaire
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.host.toLowerCase().includes(q) ||
        (r.ownerLogin ?? "").toLowerCase().includes(q) ||
        (r.ownerDisplayName ?? "").toLowerCase().includes(q)
      );
    });
  }, [allRouters, search, targetAdmin.id]);

  // Grouper par admin propriétaire
  const grouped = useMemo(() => {
    const map = new Map<string, AllRouterRow[]>();
    for (const r of filtered) {
      const label = r.ownerDisplayName || r.ownerLogin || `Admin #${r.ownerAdminId ?? "?"}`;
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(r);
    }
    return [...map.entries()];
  }, [filtered]);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Copy className="h-4 w-4 text-purple-600" />
            Copier un routeur vers {targetAdmin.displayName || targetAdmin.login}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Sélectionnez un routeur existant. Ses paramètres de connexion seront dupliqués.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
          <Input
            placeholder="Rechercher nom, IP, admin…"
            className="pl-8 h-8 text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>

        <div className="max-h-72 overflow-y-auto space-y-3 pr-1">
          {isLoading && (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          )}
          {!isLoading && grouped.length === 0 && (
            <p className="py-8 text-center text-sm text-gray-400">Aucun routeur disponible.</p>
          )}
          {grouped.map(([ownerLabel, rows]) => (
            <div key={ownerLabel}>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-1 px-1">{ownerLabel}</p>
              <div className="space-y-1">
                {rows.map((r) => {
                  const alreadyCopied = existingRouterIds.includes(r.id);
                  return (
                    <button
                      key={r.id}
                      disabled={alreadyCopied}
                      onClick={() => onCopy(r)}
                      className={[
                        "w-full flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                        alreadyCopied
                          ? "opacity-40 cursor-not-allowed border-gray-100 bg-gray-50"
                          : "border-gray-200 bg-white hover:bg-purple-50 hover:border-purple-200 cursor-pointer",
                      ].join(" ")}
                    >
                      <div className="p-1.5 rounded-md bg-purple-50 shrink-0">
                        <RouterIcon className="h-3.5 w-3.5 text-purple-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{r.name}</p>
                        <p className="text-xs text-gray-400 font-mono truncate">{formatRouterAddressDisplay(r.host, r.port)} · {r.username}</p>
                      </div>
                      {alreadyCopied && (
                        <span className="text-[10px] text-gray-400 shrink-0">déjà présent</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm" onClick={onClose}>Annuler</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ════════════════════ CopyVendorsDialog ════════════════════ */

type SlimRouter = { id: number; name: string; host: string; port: number };

function CopyVendorsDialog({
  admin, adminRouters, onClose,
}: {
  admin: AdminRow;
  adminRouters: RouterRow[];
  onClose: () => void;
}) {
  const { token } = useAuth();
  const { toast } = useToast();
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  const [fromRouterId, setFromRouterId] = useState<string>("");
  const [toRouterId,   setToRouterId]   = useState<string>("");
  const [copying, setCopying] = useState(false);

  const adminLabel = admin.displayName || admin.login;

  const { data: ownRouters = [], isLoading: loadingOwn } = useQuery<SlimRouter[]>({
    queryKey: ["super", "own-routers"],
    enabled: !!token,
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/super/own-routers`, { headers });
      if (!r.ok) throw new Error("Chargement impossible");
      return r.json();
    },
  });

  const adminOnlyRoutersDeduped = useMemo(
    () => adminRouters.filter((r) => !ownRouters.some((o) => o.id === r.id)),
    [adminRouters, ownRouters],
  );

  const destRouters = useMemo(
    () => adminRouters.filter((r) => String(r.id) !== fromRouterId),
    [adminRouters, fromRouterId],
  );

  useEffect(() => {
    if (!toRouterId) return;
    const stillValid = destRouters.some((r) => String(r.id) === toRouterId);
    if (!stillValid || toRouterId === fromRouterId) setToRouterId("");
  }, [fromRouterId, toRouterId, destRouters]);

  const canSubmit =
    !!fromRouterId
    && !!toRouterId
    && fromRouterId !== toRouterId
    && !copying
    && destRouters.some((r) => String(r.id) === toRouterId);

  const handleCopy = async () => {
    if (!canSubmit) return;
    setCopying(true);
    try {
      const r = await fetch(`${BASE}/api/super/copy-vendors`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          fromRouterId: Number(fromRouterId),
          toRouterId: Number(toRouterId),
          targetAdminId: admin.id,
        }),
      });
      const data = await r.json() as { copied?: number; skipped?: number; error?: string };
      if (!r.ok) throw new Error(data.error ?? "Opération échouée");
      toast({
        title: "Vendeurs copiés",
        description: `${data.copied} vendeur${(data.copied ?? 0) !== 1 ? "s" : ""} copié${(data.copied ?? 0) !== 1 ? "s" : ""}${(data.skipped ?? 0) > 0 ? ` · ${data.skipped} ignoré${(data.skipped ?? 0) !== 1 ? "s" : ""} (username déjà existant)` : ""}`,
      });
      onClose();
    } catch (e) {
      toast({ title: "Erreur", description: e instanceof Error ? e.message : "Opération échouée", variant: "destructive" });
    } finally {
      setCopying(false);
    }
  };

  const noSourceChoice = !loadingOwn && ownRouters.length === 0 && adminOnlyRoutersDeduped.length === 0;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-4 w-4 text-emerald-600" />
            Copier les vendeurs
          </DialogTitle>
          <DialogDescription>
            {admin.isSuperAdmin ? (
              <>
                Copiez les vendeurs d&apos;un <strong>de vos routeurs</strong> vers <strong>un autre de vos routeurs</strong>.
                La source peut aussi être un routeur modèle listé en premier. Les identifiants déjà présents sur le routeur cible sont ignorés.
              </>
            ) : (
              <>
                Copiez les vendeurs du <strong>routeur source</strong> vers le <strong>routeur cible</strong> de <strong>{adminLabel}</strong>.
                La source peut être l&apos;un de vos routeurs (modèle) ou un routeur de cet administrateur (copie A→B).
                Les identifiants déjà présents sur le routeur cible sont ignorés.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label>Routeur source</Label>
            <Select value={fromRouterId} onValueChange={setFromRouterId} disabled={loadingOwn || noSourceChoice}>
              <SelectTrigger>
                <SelectValue placeholder={
                  loadingOwn
                    ? "Chargement…"
                    : noSourceChoice
                      ? "Aucun routeur source disponible"
                      : "Choisir le routeur A (vendeurs à copier)"
                } />
              </SelectTrigger>
              <SelectContent>
                {ownRouters.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Mes routeurs (super-admin)</SelectLabel>
                    {ownRouters.map((r) => (
                      <SelectItem key={r.id} value={String(r.id)}>
                        {r.name} <span className="text-xs text-gray-400 font-mono">— {formatRouterAddressDisplay(r.host, r.port)}</span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {adminOnlyRoutersDeduped.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>{admin.isSuperAdmin ? "Vos autres routeurs" : `Routeurs de ${adminLabel}`}</SelectLabel>
                    {adminOnlyRoutersDeduped.map((r) => (
                      <SelectItem key={r.id} value={String(r.id)}>
                        {r.name} <span className="text-xs text-gray-400 font-mono">— {formatRouterAddressDisplay(r.host, r.port)}</span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-400">
              {admin.isSuperAdmin
                ? "Vos routeurs en source ; vous pouvez aussi utiliser la section « Mes routeurs » comme modèle."
                : "Modèle personnel ou routeur de l&apos;admin (copie entre deux de ses routeurs)."}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Routeur cible</Label>
            <Select
              value={toRouterId}
              onValueChange={setToRouterId}
              disabled={destRouters.length === 0 || !fromRouterId}
            >
              <SelectTrigger>
                <SelectValue placeholder={
                  !fromRouterId
                    ? "Choisissez d'abord une source"
                    : destRouters.length === 0
                      ? "Aucun autre routeur pour cet admin"
                      : "Choisir le routeur B (destination)"
                } />
              </SelectTrigger>
              <SelectContent>
                {destRouters.map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>
                    {r.name} <span className="text-xs text-gray-400 font-mono">— {formatRouterAddressDisplay(r.host, r.port)}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-400">
              {admin.isSuperAdmin
                ? "Destination : un autre de vos routeurs (le routeur source est exclu de la liste cible)."
                : `Uniquement les routeurs de ${adminLabel} — le routeur source est exclu.`}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={copying}>Annuler</Button>
          <Button
            disabled={!canSubmit}
            className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
            onClick={() => void handleCopy()}
          >
            {copying
              ? <><Loader2 className="h-4 w-4 animate-spin" />Copie…</>
              : <><Users className="h-4 w-4" />Copier les vendeurs</>
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ════════════════════ CopyOwnVendorsDialog — entre deux routeurs du super-admin ════════════════════ */

function CopyOwnVendorsDialog({ myAdminId, onClose }: { myAdminId: number; onClose: () => void }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  const [fromRouterId, setFromRouterId] = useState("");
  const [toRouterId, setToRouterId] = useState("");
  const [copying, setCopying] = useState(false);

  const { data: ownRouters = [], isLoading: loadingOwn } = useQuery<SlimRouter[]>({
    queryKey: ["super", "own-routers"],
    enabled: !!token,
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/super/own-routers`, { headers });
      if (!r.ok) throw new Error("Chargement impossible");
      return r.json();
    },
  });

  const destRouters = useMemo(
    () => ownRouters.filter((r) => String(r.id) !== fromRouterId),
    [ownRouters, fromRouterId],
  );

  useEffect(() => {
    if (!toRouterId) return;
    const stillValid = destRouters.some((r) => String(r.id) === toRouterId);
    if (!stillValid || toRouterId === fromRouterId) setToRouterId("");
  }, [fromRouterId, toRouterId, destRouters]);

  const canSubmit =
    !!fromRouterId
    && !!toRouterId
    && fromRouterId !== toRouterId
    && !copying
    && destRouters.some((r) => String(r.id) === toRouterId);

  const handleCopy = async () => {
    if (!canSubmit) return;
    setCopying(true);
    try {
      const r = await fetch(`${BASE}/api/super/copy-vendors`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          fromRouterId: Number(fromRouterId),
          toRouterId: Number(toRouterId),
          targetAdminId: myAdminId,
        }),
      });
      const data = await r.json() as { copied?: number; skipped?: number; error?: string };
      if (!r.ok) throw new Error(data.error ?? "Opération échouée");
      toast({
        title: "Vendeurs copiés",
        description: `${data.copied} vendeur${(data.copied ?? 0) !== 1 ? "s" : ""} copié${(data.copied ?? 0) !== 1 ? "s" : ""}${(data.skipped ?? 0) > 0 ? ` · ${data.skipped} ignoré${(data.skipped ?? 0) !== 1 ? "s" : ""} (username déjà existant)` : ""}`,
      });
      onClose();
    } catch (e) {
      toast({ title: "Erreur", description: e instanceof Error ? e.message : "Opération échouée", variant: "destructive" });
    } finally {
      setCopying(false);
    }
  };

  const needTwoRouters = !loadingOwn && ownRouters.length < 2;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-4 w-4 text-emerald-600" />
            Copier les vendeurs entre mes routeurs
          </DialogTitle>
          <DialogDescription>
            Dupliquez les vendeurs d&apos;un routeur source vers un autre routeur <strong>de votre compte</strong>.
            Les identifiants déjà présents sur le routeur cible sont ignorés.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label>Routeur source</Label>
            <Select value={fromRouterId} onValueChange={setFromRouterId} disabled={loadingOwn || needTwoRouters}>
              <SelectTrigger>
                <SelectValue placeholder={
                  loadingOwn
                    ? "Chargement…"
                    : needTwoRouters
                      ? "Au moins deux routeurs requis"
                      : "Choisir le routeur source"
                } />
              </SelectTrigger>
              <SelectContent>
                {ownRouters.map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>
                    {r.name} <span className="text-xs text-gray-400 font-mono">— {formatRouterAddressDisplay(r.host, r.port)}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Routeur cible</Label>
            <Select
              value={toRouterId}
              onValueChange={setToRouterId}
              disabled={destRouters.length === 0 || !fromRouterId}
            >
              <SelectTrigger>
                <SelectValue placeholder={
                  !fromRouterId
                    ? "Choisissez d'abord une source"
                    : destRouters.length === 0
                      ? "Aucun autre routeur"
                      : "Choisir le routeur cible"
                } />
              </SelectTrigger>
              <SelectContent>
                {destRouters.map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>
                    {r.name} <span className="text-xs text-gray-400 font-mono">— {formatRouterAddressDisplay(r.host, r.port)}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-400">Le routeur source n&apos;apparaît pas dans la liste cible.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={copying}>Annuler</Button>
          <Button
            disabled={!canSubmit}
            className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
            onClick={() => void handleCopy()}
          >
            {copying
              ? <><Loader2 className="h-4 w-4 animate-spin" />Copie…</>
              : <><Users className="h-4 w-4" />Copier</>
            }
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ════════════════════ Dialogs ════════════════════ */

/* ════════════════════ CreateSuperAdminDialog ════════════════════ */

function CreateSuperAdminDialog({ open, onClose, onSubmit, pending }: {
  open: boolean;
  onClose: () => void;
  onSubmit: (v: { login: string; password: string; displayName?: string; verificationCode?: string }) => void;
  pending: boolean;
}) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [verificationCode, setVerificationCode] = useState("");

  const reset = () => { setLogin(""); setPassword(""); setDisplayName(""); setVerificationCode(""); };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-orange-500" />
            Nouveau super administrateur
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nom d'affichage</Label>
            <Input autoComplete="off" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="optionnel" />
          </div>
          <div>
            <Label>Identifiant</Label>
            <Input autoComplete="off" value={login} onChange={(e) => setLogin(e.target.value)} placeholder="ex. superadmin2" />
          </div>
          <div>
            <Label>Mot de passe</Label>
            <PasswordInput autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mot de passe" />
          </div>
          <div>
            <Label>Code de vérification <span className="text-xs text-gray-400 font-normal">(défaut : 4155)</span></Label>
            <Input
              autoComplete="off"
              inputMode="numeric"
              value={verificationCode}
              onChange={(e) => setVerificationCode(e.target.value)}
              placeholder="Code requis pour modifier les identifiants"
            />
            <p className="text-xs text-gray-400 mt-1">Laissez vide pour utiliser le code par défaut 4155.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>Annuler</Button>
          <Button
            disabled={pending || !login.trim() || !password}
            className="bg-orange-500 hover:bg-orange-600 text-white"
            onClick={() => onSubmit({
              login: login.trim(),
              password,
              displayName: displayName.trim() || undefined,
              verificationCode: verificationCode.trim() || undefined,
            })}
          >
            {pending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Créer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateDialog({ open, onClose, onSubmit, pending }: {
  open: boolean;
  onClose: () => void;
  onSubmit: (v: { login: string; password: string; displayName?: string; forfaitMonths?: number; forfaitTest24h?: boolean; forfaitUnlimited?: boolean }) => void;
  pending: boolean;
}) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [months, setMonths] = useState<CreateForfaitChoice>("1");

  const reset = () => { setLogin(""); setPassword(""); setDisplayName(""); setMonths("1"); };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouvel administrateur</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nom</Label>
            <Input autoComplete="off" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="optionnel" />
          </div>
          <div>
            <Label>Identifiant</Label>
            <Input autoComplete="off" value={login} onChange={(e) => setLogin(e.target.value)} placeholder="ex. partenaire1" />
          </div>
          <div>
            <Label>Mot de passe</Label>
            <PasswordInput autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mot de passe" />
          </div>
          <div>
            <Label>Forfait initial (mois)</Label>
            <Select value={months} onValueChange={(v) => setMonths(v as typeof months)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unlimited">Illimité</SelectItem>
                <SelectItem value="0">Aucun (login bloqué)</SelectItem>
                <SelectItem value="24h">Test 24 heures</SelectItem>
                {VALID_MONTHS.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {m === 12 ? "1 an" : `${m} mois`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>Annuler</Button>
          <Button
            disabled={pending || !login.trim() || !password}
            onClick={() => onSubmit({
              login: login.trim(),
              password,
              displayName: displayName.trim() || undefined,
              forfaitMonths: months === "0" || months === "24h" || months === "unlimited" ? undefined : Number(months),
              ...(months === "24h" ? { forfaitTest24h: true } : {}),
              ...(months === "unlimited" ? { forfaitUnlimited: true } : {}),
            })}
          >
            {pending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Créer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ admin, onClose, onSubmit, pending }: {
  admin: AdminRow;
  onClose: () => void;
  onSubmit: (v: { login?: string; displayName?: string | null; password?: string; isActive?: boolean }) => void;
  pending: boolean;
}) {
  const [login, setLogin] = useState(admin.login);
  const [displayName, setDisplayName] = useState(admin.displayName ?? "");
  const originalPassword = admin.passwordPlain ?? admin.credentialPreview?.password ?? "";
  const [password, setPassword] = useState(originalPassword);
  const [isActive, setIsActive] = useState(admin.isActive);
  const [loginError, setLoginError] = useState("");

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Modifier {admin.displayName || admin.login}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nom affiché</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="optionnel" />
          </div>
          <div>
            <Label>Identifiant</Label>
            <Input
              autoComplete="off"
              value={login}
              onChange={(e) => { setLogin(e.target.value); setLoginError(""); }}
            />
            {loginError && <p className="text-xs text-red-500 mt-1">{loginError}</p>}
          </div>
          <div>
            <Label>Mot de passe</Label>
            <PasswordInput autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </div>
          {!admin.isSuperAdmin && (
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Power className={`h-4 w-4 ${isActive ? "text-emerald-600" : "text-gray-400"}`} />
                <span className="text-sm font-medium">Compte actif</span>
              </div>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button
            disabled={pending}
            onClick={() => {
              const loginTrimmed = login.trim();
              const payload: { login?: string; displayName?: string | null; password?: string; isActive?: boolean } = {};
              if (loginTrimmed !== admin.login) payload.login = loginTrimmed;
              if (displayName !== (admin.displayName ?? "")) payload.displayName = displayName.trim() || null;
              if (password !== originalPassword && password.length >= 1) payload.password = password;
              if (!admin.isSuperAdmin && isActive !== admin.isActive) payload.isActive = isActive;
              onSubmit(payload);
            }}
          >
            {pending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


function ForfaitDialog({ admin, mode, onClose, onSubmit, pending }: {
  admin: AdminRow;
  mode: "set" | "extend";
  onClose: () => void;
  onSubmit: (duration: ForfaitChoice) => void;
  pending: boolean;
}) {
  const [months, setMonths] = useState<ForfaitChoice>("1");
  const isExtend = mode === "extend";

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isExtend ? "Prolonger le forfait" : "Définir le forfait"} — {admin.displayName || admin.login}
          </DialogTitle>
          <DialogDescription>
            {isExtend
              ? "L'extension repart de la date de fin actuelle (ou de maintenant si expiré)."
              : "Le forfait sera redéfini à compter de maintenant."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {admin.forfaitEndsAt && (
            <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-sm">
              <div className="flex items-center gap-1.5 text-gray-600">
                <Calendar className="h-3.5 w-3.5" />
                <span className="text-xs uppercase tracking-wide">Forfait actuel</span>
              </div>
              <p className="mt-1">Fin : <span className="font-medium">{fmt(admin.forfaitEndsAt)}</span></p>
            </div>
          )}
          <div>
            <Label>Durée</Label>
            <Select value={months} onValueChange={(v) => setMonths(v as typeof months)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unlimited">Illimité</SelectItem>
                <SelectItem value="24h">Test 24 heures</SelectItem>
                {VALID_MONTHS.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {m === 12 ? "1 an" : `${m} mois`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button disabled={pending} onClick={() => onSubmit(months)}>
            {pending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isExtend ? "Prolonger" : "Définir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreditsDialog({ admin, onClose, onSubmit, pending }: {
  admin: AdminRow;
  onClose: () => void;
  onSubmit: (delta: number) => void;
  pending: boolean;
}) {
  const [amount, setAmount] = useState("50");
  const [op, setOp] = useState<"add" | "remove">("add");
  const n = Math.max(0, Math.round(Number(amount) || 0));
  const delta = op === "add" ? n : -n;
  const newBalance = admin.credits + delta;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Crédits — {admin.displayName || admin.login}</DialogTitle>
          <DialogDescription>
            Solde actuel : <span className="font-semibold text-gray-900">{admin.credits} crédits</span>.
            Un pack de 5 routeurs = 50 crédits.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Opération</Label>
            <Select value={op} onValueChange={(v) => setOp(v as "add" | "remove")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="add">Allouer (+)</SelectItem>
                <SelectItem value="remove">Retirer (−)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Montant</Label>
            <Input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 text-sm text-blue-900">
            Nouveau solde : <span className="font-semibold">{Math.max(0, newBalance)} crédits</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button disabled={pending || n === 0} onClick={() => onSubmit(delta)}>
            {pending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            <KeyRound className="h-4 w-4 mr-1" />
            Confirmer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ──────────── AccountDialog: super-admin self-service login/password ──────────── */
function AccountDialog({ open, onClose, onSubmit, pending, currentAdmin }: {
  open: boolean;
  onClose: () => void;
  onSubmit: (v: { login?: string; password?: string }) => void;
  pending: boolean;
  currentAdmin: AdminRow | null;
}) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (open) {
      setLogin(currentAdmin?.login ?? "");
      setPassword(currentAdmin?.passwordPlain ?? "");
    }
  }, [open, currentAdmin]);

  const reset = () => { setLogin(""); setPassword(""); };

  const loginInvalid = false;
  const passwordInvalid = false;
  const nothingToChange = login.trim().length === 0 && password.length === 0;

  const canSubmit = !pending && !nothingToChange && !loginInvalid && !passwordInvalid;

  const handleSubmit = () => {
    const payload: { login?: string; password?: string } = {};
    if (login.trim().length > 0) payload.login = login.trim();
    if (password.length > 0) payload.password = password;
    onSubmit(payload);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mes identifiants</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="acc-login">Login</Label>
            <Input
              id="acc-login"
              autoComplete="username"
              placeholder="Identifiant de connexion"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="acc-password">Mot de passe</Label>
            <PasswordInput
              id="acc-password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>Annuler</Button>
          <Button disabled={!canSubmit} onClick={handleSubmit}>
            {pending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            <KeyRound className="h-4 w-4 mr-1" />
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
