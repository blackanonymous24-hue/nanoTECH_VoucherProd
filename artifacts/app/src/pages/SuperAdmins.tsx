import { useMemo, useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users, ShieldCheck, Plus, Pencil, Trash2, Calendar, Coins,
  CalendarPlus, Power, KeyRound, Loader2, Crown, UserCog, Router as RouterIcon, Search,
  FileCode, Save, ServerCog, RotateCcw, Upload, BookMarked, Sliders, Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription, DialogClose,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import {
  DEFAULT_MIKHMON_PHP,
  PHP_KEY,
  CUSTOM_DEFAULT_KEY,
  getCustomDefault,
} from "@/pages/TicketTemplate";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { foldText } from "@/lib/text";

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


function parseAddress(address: string): { host: string; port: number } {
  const colonIdx = address.lastIndexOf(":");
  if (colonIdx > 0) {
    const portStr = address.slice(colonIdx + 1);
    if (/^\d+$/.test(portStr)) {
      return { host: address.slice(0, colonIdx), port: parseInt(portStr, 10) };
    }
  }
  return { host: address, port: 8728 };
}

function fmt(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function forfaitStatus(a: AdminRow): { label: string; tone: "success" | "danger" | "warning" | "neutral" } {
  if (a.isSuperAdmin) return { label: "Illimité", tone: "success" };
  if (a.forfaitStartedAt && !a.forfaitEndsAt) return { label: "Illimité", tone: "success" };
  if (!a.forfaitEndsAt) return { label: "Aucun forfait", tone: "danger" };
  const end = new Date(a.forfaitEndsAt).getTime();
  const now = Date.now();
  if (end < now) return { label: "Expiré", tone: "danger" };
  const days = Math.ceil((end - now) / 86_400_000);
  if (days <= 7) return { label: `${days} j restant${days > 1 ? "s" : ""}`, tone: "warning" };
  return { label: `${days} jours`, tone: "success" };
}

export default function SuperAdmins() {
  const { token, isSuperAdmin } = useAuth();
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
  const [templateTarget, setTemplateTarget] = useState<AdminRow | null>(null);

  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  const { data: admins = [], isLoading } = useQuery<AdminRow[]>({
    queryKey: ["super", "admins"],
    enabled: !!token && isSuperAdmin,
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/super/admins`, { headers });
      if (!r.ok) throw new Error((await r.json()).error ?? "Erreur de chargement");
      const data = await r.json();
      // Endpoint returns { admins: [...] }; tolerate either shape.
      return Array.isArray(data) ? data : (data?.admins ?? []);
    },
  });

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
    const ok = confirm(`Supprimer l'administrateur « ${admin.displayName || admin.login} » et toutes ses données ?`);
    if (!ok) return;
    setDeletingAdminId(admin.id);
    try {
      await deleteM.mutateAsync(admin.id);
      qc.setQueryData<AdminRow[]>(["super", "admins"], (prev) =>
        Array.isArray(prev) ? prev.filter((a) => a.id !== admin.id) : prev,
      );
      refresh();
      toast({ title: "Administrateur supprimé" });
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
            onClick={() => { setCreateSuperKey((k) => k + 1); setCreateSuperOpen(true); }}
            className="gap-2 bg-orange-500 hover:bg-orange-600 text-white"
          >
            <ShieldCheck className="h-4 w-4" />
            <span className="hidden sm:inline">Nouveau super admin</span>
            <span className="sm:hidden">Super admin</span>
          </Button>
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
                  const status = forfaitStatus(a);
                  const limit = 5 + a.extraRouterSlots;
                  const isExpired = !a.isSuperAdmin && !!a.forfaitEndsAt && new Date(a.forfaitEndsAt).getTime() < Date.now();
                  const isExpiredAndInactive = isExpired && !a.isActive;
                  const toneClass =
                    status.tone === "success" ? "bg-emerald-100 text-emerald-700" :
                    status.tone === "warning" ? "bg-amber-100 text-amber-700" :
                    status.tone === "danger"  ? "bg-red-100 text-red-700" :
                    "bg-gray-100 text-gray-700";
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
                              <p className="font-semibold text-gray-900">{a.displayName || a.login}</p>
                            ) : (
                              <button
                                type="button"
                                className="font-semibold text-blue-700 hover:text-blue-900 hover:underline text-left"
                                onClick={() => setAdminRouterPanel(a)}
                                title="Voir les routeurs de cet admin"
                              >
                                {a.displayName || a.login}
                              </button>
                            )}
                            <p className="text-xs text-gray-500">@{a.login}</p>
                            {a.credentialPreview && (
                              <p className="text-[11px] text-amber-700 mt-0.5">
                                Nouveaux identifiants:{" "}
                                {a.credentialPreview.login ? `login=${a.credentialPreview.login}` : ""}{" "}
                                {a.credentialPreview.password ? `| mdp=${a.credentialPreview.password}` : ""}
                              </p>
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
                        <div className="space-y-1">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${toneClass}`}>
                            {status.label}
                          </span>
                          {!a.isSuperAdmin && a.forfaitEndsAt && (
                            <p className="text-xs text-gray-500">Fin : {fmt(a.forfaitEndsAt)}</p>
                          )}
                        </div>
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
                          {!a.isSuperAdmin && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                              title="Supprimer"
                              onClick={() => void handleDeleteAdmin(a)}
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

      {/* Create super admin dialog */}
      <CreateSuperAdminDialog key={createSuperKey} open={createSuperOpen} onClose={() => setCreateSuperOpen(false)} onSubmit={(v) => createSuperM.mutate(v)} pending={createSuperM.isPending} />

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

      {/* Template de ticket dialog */}
      {templateTarget && (
        <TemplateDialog
          admin={templateTarget}
          onClose={() => setTemplateTarget(null)}
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
  const qk = ["super", "admin-routers", admin.id];

  const [formTarget, setFormTarget] = useState<RouterRow | "create" | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [showCopyVendors, setShowCopyVendors] = useState(false);
  const [showCopyRouter, setShowCopyRouter] = useState(false);

  const { data: routers = [], isLoading } = useQuery<RouterRow[]>({
    queryKey: qk,
    enabled: !!token,
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/super/admins/${admin.id}/routers`, { headers });
      if (!r.ok) throw new Error("Chargement des routeurs impossible");
      return r.json();
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: qk });

  const createM = useMutation({
    mutationFn: async (p: { name: string; hotspotName?: string; contact?: string; address: string; username: string; password: string }) => {
      const { host, port } = parseAddress(p.address);
      const r = await fetch(`${BASE}/api/super/admins/${admin.id}/routers`, {
        method: "POST", headers,
        body: JSON.stringify({ name: p.name, hotspotName: p.hotspotName || undefined, contact: p.contact || undefined, host, port, username: p.username, password: p.password }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Création impossible");
      return r.json();
    },
    onSuccess: () => { setFormTarget(null); invalidate(); toast({ title: "Routeur ajouté" }); },
    onError: (e: Error) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const editM = useMutation({
    mutationFn: async (p: { id: number; name: string; hotspotName?: string; contact?: string; address: string; username: string; password: string }) => {
      const { host, port } = parseAddress(p.address);
      const r = await fetch(`${BASE}/api/super/admins/${admin.id}/routers/${p.id}`, {
        method: "PUT", headers,
        body: JSON.stringify({ name: p.name, hotspotName: p.hotspotName || undefined, contact: p.contact || undefined, host, port, username: p.username, password: p.password }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Mise à jour impossible");
      return r.json();
    },
    onSuccess: () => { setFormTarget(null); invalidate(); toast({ title: "Routeur mis à jour" }); },
    onError: (e: Error) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const deleteRouter = async (r: RouterRow) => {
    if (!confirm(`Supprimer le routeur « ${r.name} » et toutes ses données ?`)) return;
    setDeletingId(r.id);
    try {
      const res = await fetch(`${BASE}/api/super/admins/${admin.id}/routers/${r.id}`, { method: "DELETE", headers });
      if (!res.ok) throw new Error((await res.json()).error ?? "Suppression impossible");
      invalidate();
      toast({ title: "Routeur supprimé" });
    } catch (e) {
      toast({ title: "Erreur", description: e instanceof Error ? e.message : "Opération échouée", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  const pending = createM.isPending || editM.isPending;

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col gap-0 p-0 overflow-y-auto">
        <SheetHeader className="px-5 py-4 border-b shrink-0">
          <SheetTitle className="flex items-center gap-2 text-base">
            <ServerCog className="h-4 w-4 text-blue-600" />
            Routeurs — {admin.displayName || admin.login}
          </SheetTitle>
          <SheetDescription>
            {routers.length} routeur{routers.length !== 1 ? "s" : ""} · Limite {5 + admin.extraRouterSlots}
          </SheetDescription>
        </SheetHeader>

        <div className="flex items-center justify-between px-5 py-3 border-b shrink-0 gap-2">
          <span className="text-sm text-gray-500 shrink-0">{isLoading ? "Chargement…" : `${routers.length} routeur${routers.length !== 1 ? "s" : ""}`}</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="gap-1.5 text-emerald-700 border-emerald-200 hover:bg-emerald-50" onClick={() => setShowCopyVendors(true)}>
              <Users className="h-3.5 w-3.5" /> Copier vendeurs
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 text-purple-700 border-purple-200 hover:bg-purple-50" onClick={() => setShowCopyRouter(true)}>
              <Copy className="h-3.5 w-3.5" /> Copier routeur
            </Button>
            <Button size="sm" className="gap-1.5" onClick={() => setFormTarget("create")}>
              <Plus className="h-3.5 w-3.5" /> Ajouter
            </Button>
          </div>
        </div>

        <div className="flex-1 px-5 py-3 space-y-2">
          {isLoading && (
            <div className="space-y-2 py-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          )}
          {!isLoading && routers.length === 0 && (
            <div className="py-10 text-center text-sm text-gray-400">Aucun routeur pour cet admin.</div>
          )}
          {routers.map((r) => (
            <div key={r.id} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 hover:bg-gray-50 transition-colors">
              <div className="p-2 rounded-lg bg-blue-50 shrink-0">
                <RouterIcon className="h-4 w-4 text-blue-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-gray-900 truncate">{r.name}</p>
                <p className="text-xs text-gray-500 font-mono truncate">{r.host}:{r.port} · {r.username}</p>
                {r.hotspotName && <p className="text-xs text-gray-400 truncate">{r.hotspotName}</p>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button size="icon" variant="ghost" title="Modifier" onClick={() => setFormTarget(r)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="icon" variant="ghost"
                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  title="Supprimer"
                  disabled={deletingId !== null}
                  onClick={() => void deleteRouter(r)}
                >
                  {deletingId === r.id
                    ? <Loader2 className="h-4 w-4 animate-spin text-red-600" />
                    : <Trash2 className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          ))}
        </div>

        {formTarget !== null && (
          <RouterFormDialog
            router={formTarget === "create" ? null : formTarget}
            onClose={() => setFormTarget(null)}
            pending={pending}
            onSubmit={(p) => {
              if (formTarget === "create") createM.mutate(p);
              else editM.mutate({ id: formTarget.id, ...p });
            }}
          />
        )}

        {showCopyVendors && (
          <CopyVendorsDialog
            admin={admin}
            adminRouters={routers}
            onClose={() => setShowCopyVendors(false)}
          />
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
                hotspotName: r.hotspotName ?? undefined,
                contact: r.contact ?? undefined,
                address: `${r.host}:${r.port}`,
                username: r.username,
                password: r.password,
              });
            }}
          />
        )}
      </SheetContent>
    </Sheet>
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
                        <p className="text-xs text-gray-400 font-mono truncate">{r.host}:{r.port} · {r.username}</p>
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

function RouterFormDialog({
  router, onClose, onSubmit, pending,
}: {
  router: RouterRow | null;
  onClose: () => void;
  onSubmit: (p: { name: string; hotspotName?: string; contact?: string; address: string; username: string; password: string }) => void;
  pending: boolean;
}) {
  const isEdit = router !== null;
  const [name, setName] = useState(router?.name ?? "");
  const [hotspotName, setHotspotName] = useState(router?.hotspotName ?? "");
  const [contact, setContact] = useState(router?.contact ?? "");
  const [address, setAddress] = useState(router ? `${router.host}:${router.port}` : "");
  const [username, setUsername] = useState(router?.username ?? "admin");
  const [password, setPassword] = useState(router?.password ?? "");

  const canSubmit = !pending && !!name.trim() && !!address.trim() && !!username.trim() && password.length >= 1;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? `Modifier — ${router!.name}` : "Ajouter un routeur"}</DialogTitle>
          <DialogDescription>{isEdit ? "Modifiez les informations du routeur." : "Ce routeur sera rattaché directement à cet administrateur."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div><Label>Nom <span className="text-red-500">*</span></Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mon routeur" /></div>
          <div><Label>Nom du hotspot</Label><Input value={hotspotName} onChange={(e) => setHotspotName(e.target.value)} placeholder="optionnel" /></div>
          <div><Label>Contact</Label><Input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="optionnel" /></div>
          <div>
            <Label>Adresse (hôte:port) <span className="text-red-500">*</span></Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="192.168.88.1:8728" className="font-mono" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Utilisateur <span className="text-red-500">*</span></Label><Input value={username} onChange={(e) => setUsername(e.target.value)} /></div>
            <div>
              <Label>Mot de passe <span className="text-red-500">*</span></Label>
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button
            disabled={!canSubmit}
            onClick={() => onSubmit({ name: name.trim(), hotspotName: hotspotName.trim() || undefined, contact: contact.trim() || undefined, address: address.trim(), username: username.trim(), password })}
          >
            {pending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEdit ? "Enregistrer" : "Ajouter"}
          </Button>
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

  // Charger les routeurs du super-admin (source)
  const { data: ownRouters = [], isLoading: loadingOwn } = useQuery<SlimRouter[]>({
    queryKey: ["super", "own-routers"],
    enabled: !!token,
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/super/own-routers`, { headers });
      if (!r.ok) throw new Error("Chargement impossible");
      return r.json();
    },
  });

  const canSubmit = !!fromRouterId && !!toRouterId && !copying;

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

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-4 w-4 text-emerald-600" />
            Copier les vendeurs
          </DialogTitle>
          <DialogDescription>
            Attribuer les vendeurs d'un de vos routeurs comme base pour un routeur de <strong>{admin.displayName || admin.login}</strong>.
            Les vendeurs dont l'identifiant existe déjà sur le routeur cible sont ignorés.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Source — routeur du super-admin */}
          <div className="space-y-1.5">
            <Label>Vendeurs du routeur</Label>
            <Select value={fromRouterId} onValueChange={setFromRouterId} disabled={loadingOwn}>
              <SelectTrigger>
                <SelectValue placeholder={loadingOwn ? "Chargement…" : ownRouters.length === 0 ? "Aucun routeur disponible" : "Choisir un routeur source"} />
              </SelectTrigger>
              <SelectContent>
                {ownRouters.map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>
                    {r.name} <span className="text-xs text-gray-400 font-mono">— {r.host}:{r.port}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-400">Vos routeurs (super-admin) — source des vendeurs</p>
          </div>

          {/* Cible — routeur de l'admin */}
          <div className="space-y-1.5">
            <Label>Vers routeur</Label>
            <Select value={toRouterId} onValueChange={setToRouterId} disabled={adminRouters.length === 0}>
              <SelectTrigger>
                <SelectValue placeholder={adminRouters.length === 0 ? "Aucun routeur pour cet admin" : "Choisir un routeur cible"} />
              </SelectTrigger>
              <SelectContent>
                {adminRouters.map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>
                    {r.name} <span className="text-xs text-gray-400 font-mono">— {r.host}:{r.port}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-400">Routeurs de {admin.displayName || admin.login} — destination</p>
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
            <PasswordInput autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="min. 4 caractères" />
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
            disabled={pending || !login.trim() || password.length < 4}
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
            <PasswordInput autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="min. 4 caractères" />
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
            disabled={pending || !login.trim() || password.length < 4}
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
            <Label>Identifiant</Label>
            <Input
              autoComplete="off"
              value={login}
              onChange={(e) => { setLogin(e.target.value); setLoginError(""); }}
            />
            {loginError && <p className="text-xs text-red-500 mt-1">{loginError}</p>}
          </div>
          <div>
            <Label>Nom affiché</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
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
              if (loginTrimmed.length < 2) { setLoginError("Identifiant trop court (min 2 caractères)"); return; }
              const payload: { login?: string; displayName?: string | null; password?: string; isActive?: boolean } = {};
              if (loginTrimmed !== admin.login) payload.login = loginTrimmed;
              if (displayName !== (admin.displayName ?? "")) payload.displayName = displayName.trim() || null;
              if (password !== originalPassword && password.length >= 4) payload.password = password;
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

const SCALE_DESKTOP_KEY = "vn_print_scale_desktop";
const SCALE_MOBILE_KEY  = "vn_print_scale_mobile";
function readScale(key: string, def = 85): number {
  try { const v = parseInt(localStorage.getItem(key) ?? String(def), 10); return isNaN(v) ? def : v; } catch { return def; }
}
function saveScale(key: string, v: number) {
  try { localStorage.setItem(key, String(v)); } catch { /* ignore */ }
}

function TemplateDialog({ admin, onClose }: {
  admin: AdminRow;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [templateCode, setTemplateCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showScaleDialog, setShowScaleDialog] = useState(false);
  const deskKey = `${SCALE_DESKTOP_KEY}_admin_${admin.id}`;
  const mobKey  = `${SCALE_MOBILE_KEY}_admin_${admin.id}`;
  const [scaleDesktop, setScaleDesktop] = useState(() => readScale(deskKey, 85));
  const [scaleMobile,  setScaleMobile]  = useState(() => readScale(mobKey,  85));
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`${BASE}/api/super/admins/${admin.id}/ticket-template`)
      .then((r) => r.ok ? r.json() : { template: null })
      .then((data: { template: string | null }) => setTemplateCode(data.template ?? ""))
      .catch(() => setTemplateCode(""))
      .finally(() => setLoading(false));
  }, [admin.id]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const r = await fetch(`${BASE}/api/super/admins/${admin.id}/ticket-template`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template: templateCode }),
      });
      if (r.ok) {
        toast({ title: "Template sauvegardé", description: `Modèle de ticket mis à jour pour ${admin.displayName || admin.login}.` });
        onClose();
      } else {
        toast({ title: "Erreur", description: "Impossible de sauvegarder le template.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur réseau", description: "Vérifiez votre connexion.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    const base = getCustomDefault() ?? DEFAULT_MIKHMON_PHP;
    setTemplateCode(base);
    toast({ title: "Modèle réinitialisé", description: "Le modèle de base a été restauré." });
  };

  const handleUseDefaultMikhmon = () => {
    setTemplateCode(DEFAULT_MIKHMON_PHP);
    toast({ title: "Modèle Mikhmon chargé", description: "Le template PHP par défaut est prêt. Cliquez Sauvegarder pour l'activer." });
  };

  const handleImportPHP = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const raw = ev.target?.result as string;
      setTemplateCode(raw);
      try { localStorage.setItem(PHP_KEY, raw); localStorage.setItem(CUSTOM_DEFAULT_KEY, raw); } catch { /* ignore */ }
      toast({ title: "Fichier PHP importé", description: `« ${file.name} » chargé. Cliquez Sauvegarder pour l'activer.` });
    };
    reader.readAsText(file, "UTF-8");
    e.target.value = "";
  };

  const handleSetAsDefault = () => {
    if (!templateCode.trim()) return;
    try { localStorage.setItem(CUSTOM_DEFAULT_KEY, templateCode); localStorage.setItem(PHP_KEY, templateCode); } catch { /* ignore */ }
    toast({ title: "Modèle de base défini", description: "Ce modèle sera utilisé comme base locale sur cet appareil." });
  };

  return (
    <>
      <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileCode className="h-5 w-5 text-violet-600" />
              Modèle de ticket — {admin.displayName || admin.login}
            </DialogTitle>
            <DialogDescription>
              Template PHP Mikhmon v3 appliqué à cet admin sur tous ses appareils (mobile, APK, desktop).
              Laisser vide pour utiliser le template par défaut.
            </DialogDescription>
          </DialogHeader>

          {/* ── Barre d'outils ── */}
          <div className="flex items-center gap-1.5 flex-nowrap overflow-x-auto">
            <Button variant="outline" size="sm" onClick={handleReset} className="gap-1.5 text-orange-600 border-orange-200 hover:bg-orange-50 shrink-0" title="Réinitialiser">
              <RotateCcw className="h-3.5 w-3.5" />
              Réinitialiser
            </Button>
            <Button variant="outline" size="sm" onClick={handleUseDefaultMikhmon} className="gap-1.5 shrink-0" title="Coller modèle Mikhmon">
              <FileCode className="h-3.5 w-3.5" />
              Coller modèle Mikhmon
            </Button>
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} className="gap-1.5 shrink-0" title="Importer .php">
              <Upload className="h-3.5 w-3.5" />
              Importer .php
            </Button>
            <input ref={fileRef} type="file" accept=".php" className="hidden" onChange={handleImportPHP} />
            <Button variant="outline" size="sm" onClick={handleSetAsDefault} className="gap-1.5 text-blue-700 border-blue-200 hover:bg-blue-50 shrink-0" title="Définir comme modèle de base">
              <BookMarked className="h-3.5 w-3.5" />
              Définir par défaut
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowScaleDialog(true)} className="gap-1.5 text-purple-700 border-purple-200 hover:bg-purple-50 h-auto py-1 shrink-0" title="Échelle d'impression">
              <Sliders className="h-3.5 w-3.5 shrink-0" />
              <span className="leading-tight text-left">
                <span className="block text-[11px]">🖥 {scaleDesktop}%</span>
                <span className="block text-[11px]">📱 {scaleMobile}%</span>
              </span>
            </Button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Chargement du template…
            </div>
          ) : (
            <textarea
              className="w-full rounded-md border bg-background px-3 py-2 text-xs font-mono resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              rows={10}
              value={templateCode}
              onChange={(e) => setTemplateCode(e.target.value)}
              placeholder="Collez ici le template PHP Mikhmon v3…"
              spellCheck={false}
            />
          )}

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Annuler</Button>
            <Button disabled={saving || loading} onClick={handleSave}>
              {saving
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sauvegarde…</>
                : <><Save className="h-4 w-4 mr-2" />Sauvegarder</>
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog échelle d'impression ── */}
      <Dialog open={showScaleDialog} onOpenChange={setShowScaleDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sliders className="h-4 w-4 text-purple-600" />
              Échelle d'impression
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-6 py-2">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-gray-700">🖥 Desktop / Laptop</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number" min={50} max={100} step={5}
                    value={scaleDesktop}
                    onChange={(e) => { const v = Math.min(100, Math.max(50, parseInt(e.target.value) || 50)); setScaleDesktop(v); saveScale(deskKey, v); }}
                    className="w-16 rounded border border-purple-200 bg-white px-1.5 py-0.5 text-right font-mono text-sm font-bold text-purple-700 focus:outline-none focus:ring-1 focus:ring-purple-400"
                  />
                  <span className="text-xs text-gray-500">%</span>
                </div>
              </div>
              <Slider
                min={50} max={100} step={5}
                value={[scaleDesktop]}
                onValueChange={([v]) => { setScaleDesktop(v); saveScale(deskKey, v); }}
              />
              <p className="text-xs text-gray-400">Correspond au zoom d'impression du navigateur web sur ordinateur.</p>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-gray-700">📱 Mobile / Tablette</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number" min={50} max={100} step={5}
                    value={scaleMobile}
                    onChange={(e) => { const v = Math.min(100, Math.max(50, parseInt(e.target.value) || 50)); setScaleMobile(v); saveScale(mobKey, v); }}
                    className="w-16 rounded border border-purple-200 bg-white px-1.5 py-0.5 text-right font-mono text-sm font-bold text-purple-700 focus:outline-none focus:ring-1 focus:ring-purple-400"
                  />
                  <span className="text-xs text-gray-500">%</span>
                </div>
              </div>
              <Slider
                min={50} max={100} step={5}
                value={[scaleMobile]}
                onValueChange={([v]) => { setScaleMobile(v); saveScale(mobKey, v); }}
              />
              <p className="text-xs text-gray-400">Correspond au zoom d'impression sur iPhone / Android.</p>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button size="sm" className="gap-1.5"><Save className="h-3.5 w-3.5" />Enregistrer</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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

  const loginInvalid = login.trim().length > 0 && login.trim().length < 2;
  const passwordInvalid = password.length > 0 && password.length < 4;
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
            {loginInvalid && (
              <p className="mt-1 text-xs text-red-600">Min. 2 caractères</p>
            )}
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
            {passwordInvalid && (
              <p className="mt-1 text-xs text-red-600">Min. 4 caractères</p>
            )}
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
