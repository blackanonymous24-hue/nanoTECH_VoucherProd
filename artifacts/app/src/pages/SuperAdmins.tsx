import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users, ShieldCheck, Plus, Pencil, Trash2, Calendar, Coins,
  CalendarPlus, Power, KeyRound, Loader2, Crown, UserCog,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const VALID_MONTHS = [1, 2, 3, 4, 5, 6, 12] as const;

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
  createdAt: string;
}

function fmt(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function forfaitStatus(a: AdminRow): { label: string; tone: "success" | "danger" | "warning" | "neutral" } {
  if (a.isSuperAdmin) return { label: "Illimité", tone: "success" };
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
  const [editing, setEditing] = useState<AdminRow | null>(null);
  const [forfaitTarget, setForfaitTarget] = useState<{ admin: AdminRow; mode: "set" | "extend" } | null>(null);
  const [creditsTarget, setCreditsTarget] = useState<AdminRow | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);

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
    mutationFn: async (v: { login: string; password: string; displayName?: string; forfaitMonths?: number }) => {
      const r = await fetch(`${BASE}/api/super/admins`, { method: "POST", headers, body: JSON.stringify(v) });
      if (!r.ok) throw new Error((await r.json()).error ?? "Création impossible");
      return r.json();
    },
    onSuccess: () => { setCreateOpen(false); refresh(); toast({ title: "Administrateur créé" }); },
    onError: handleErr,
  });

  const editM = useMutation({
    mutationFn: async (v: { id: number; displayName?: string | null; password?: string; isActive?: boolean }) => {
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
    onSuccess: () => { refresh(); toast({ title: "Administrateur supprimé" }); },
    onError: handleErr,
  });

  const forfaitM = useMutation({
    mutationFn: async (v: { id: number; months: number; mode: "set" | "extend" }) => {
      const url = v.mode === "extend"
        ? `${BASE}/api/super/admins/${v.id}/forfait/extend`
        : `${BASE}/api/super/admins/${v.id}/forfait`;
      const r = await fetch(url, { method: "POST", headers, body: JSON.stringify({ months: v.months }) });
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
            <p className="text-sm text-gray-500">Gérez les comptes administrateurs, forfaits et crédits</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setAccountOpen(true)} className="gap-2" title="Modifier mes identifiants">
            <UserCog className="h-4 w-4" />
            <span className="hidden sm:inline">Mon compte</span>
          </Button>
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Nouvel administrateur
          </Button>
        </div>
      </div>

      {/* Table card */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-8 flex items-center justify-center gap-2 text-gray-500 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
          </div>
        ) : admins.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            Aucun administrateur. Cliquez sur « Nouvel administrateur » pour commencer.
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
                {admins.map((a) => {
                  const status = forfaitStatus(a);
                  const limit = 5 + a.extraRouterSlots;
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
                            <p className="font-semibold text-gray-900">{a.displayName || a.login}</p>
                            <p className="text-xs text-gray-500">@{a.login}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={a.isActive ? "default" : "destructive"} className={a.isActive ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100" : ""}>
                          {a.isActive ? "Actif" : "Désactivé"}
                        </Badge>
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
                            </>
                          )}
                          <Button size="icon" variant="ghost" title="Modifier"
                            onClick={() => setEditing(a)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {!a.isSuperAdmin && (
                            <Button size="icon" variant="ghost" title="Supprimer"
                              onClick={() => {
                                if (confirm(`Supprimer l'administrateur « ${a.displayName || a.login} » et toutes ses données ?`)) {
                                  deleteM.mutate(a.id);
                                }
                              }}>
                              <Trash2 className="h-4 w-4 text-red-600" />
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

      {/* Create dialog */}
      <CreateDialog open={createOpen} onClose={() => setCreateOpen(false)} onSubmit={(v) => createM.mutate(v)} pending={createM.isPending} />

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
          onSubmit={(months) => forfaitM.mutate({ id: forfaitTarget.admin.id, months, mode: forfaitTarget.mode })}
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

      {/* My credentials (self) dialog */}
      <AccountDialog
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        onSubmit={(v) => accountM.mutate(v)}
        pending={accountM.isPending}
      />
    </div>
  );
}

/* ════════════════════ Dialogs ════════════════════ */

function CreateDialog({ open, onClose, onSubmit, pending }: {
  open: boolean;
  onClose: () => void;
  onSubmit: (v: { login: string; password: string; displayName?: string; forfaitMonths?: number }) => void;
  pending: boolean;
}) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [months, setMonths] = useState<string>("1");

  const reset = () => { setLogin(""); setPassword(""); setDisplayName(""); setMonths("1"); };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouvel administrateur</DialogTitle>
          <DialogDescription>Créez un compte administrateur isolé avec son propre forfait.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Identifiant</Label>
            <Input value={login} onChange={(e) => setLogin(e.target.value)} placeholder="ex. partenaire1" autoFocus />
          </div>
          <div>
            <Label>Nom affiché</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="optionnel" />
          </div>
          <div>
            <Label>Mot de passe</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="min. 4 caractères" />
          </div>
          <div>
            <Label>Forfait initial (mois)</Label>
            <Select value={months} onValueChange={setMonths}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Aucun (login bloqué)</SelectItem>
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
              forfaitMonths: months === "0" ? undefined : Number(months),
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
  onSubmit: (v: { displayName?: string | null; password?: string; isActive?: boolean }) => void;
  pending: boolean;
}) {
  const [displayName, setDisplayName] = useState(admin.displayName ?? "");
  const [password, setPassword] = useState("");
  const [isActive, setIsActive] = useState(admin.isActive);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Modifier {admin.displayName || admin.login}</DialogTitle>
          <DialogDescription>L'identifiant ne peut pas être changé.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nom affiché</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div>
            <Label>Nouveau mot de passe</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="laisser vide pour conserver" />
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
              const payload: { displayName?: string | null; password?: string; isActive?: boolean } = {};
              if (displayName !== (admin.displayName ?? "")) payload.displayName = displayName.trim() || null;
              if (password.length >= 4) payload.password = password;
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
  onSubmit: (months: number) => void;
  pending: boolean;
}) {
  const [months, setMonths] = useState<string>("1");
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
            <Select value={months} onValueChange={setMonths}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
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
          <Button disabled={pending} onClick={() => onSubmit(Number(months))}>
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
function AccountDialog({ open, onClose, onSubmit, pending }: {
  open: boolean;
  onClose: () => void;
  onSubmit: (v: { login?: string; password?: string }) => void;
  pending: boolean;
}) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const reset = () => { setLogin(""); setPassword(""); setConfirm(""); };

  const loginInvalid = login.length > 0 && login.trim().length < 3;
  const passwordInvalid = password.length > 0 && password.length < 4;
  const confirmMismatch = password.length > 0 && confirm !== password;
  const nothingToChange = login.trim().length === 0 && password.length === 0;

  const canSubmit =
    !pending &&
    !nothingToChange &&
    !loginInvalid &&
    !passwordInvalid &&
    !confirmMismatch;

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
          <DialogDescription>
            Modifiez votre login et/ou votre mot de passe. Laissez un champ vide pour ne pas le changer.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="acc-login">Nouveau login</Label>
            <Input
              id="acc-login"
              autoComplete="username"
              placeholder="Laisser vide pour conserver"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
            />
            {loginInvalid && (
              <p className="mt-1 text-xs text-red-600">Min. 3 caractères</p>
            )}
          </div>
          <div>
            <Label htmlFor="acc-password">Nouveau mot de passe</Label>
            <Input
              id="acc-password"
              type="password"
              autoComplete="new-password"
              placeholder="Laisser vide pour conserver"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {passwordInvalid && (
              <p className="mt-1 text-xs text-red-600">Min. 4 caractères</p>
            )}
          </div>
          <div>
            <Label htmlFor="acc-confirm">Confirmer le mot de passe</Label>
            <Input
              id="acc-confirm"
              type="password"
              autoComplete="new-password"
              placeholder="Confirmer"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={password.length === 0}
            />
            {confirmMismatch && (
              <p className="mt-1 text-xs text-red-600">Les mots de passe ne correspondent pas</p>
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
