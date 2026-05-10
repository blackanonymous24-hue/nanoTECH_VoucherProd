import { useState, useMemo } from "react";
import { useRefetchOnEmpty } from "@/hooks/use-refetch-on-empty";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import {
  useCreateVendor,
  useUpdateVendor,
  useDeleteVendor,
  useGetVendorReportsSummary,
  getGetVendorReportsSummaryQueryKey,
  getVendorReportsSummary,
} from "@workspace/api-client-react";
import { withApiPauseCacheFallback } from "@/lib/queryFnApiPauseCache";
import type { Vendor, VendorSummary } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouterContext } from "@/contexts/RouterContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Users, Plus, Trash2, Phone, Check, X, Mail, KeyRound, ExternalLink, Pencil, Tag, RefreshCw, Percent, Receipt, WifiOff, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { runHotspotUserToggleBatches, TOGGLE_BATCH_SIZE } from "@/lib/hotspot-bulk-toggle";
import { useAuthQueryScope, withAuthQueryScope } from "@/lib/auth-query-scope";

export type PersonFormData = {
  name: string;
  phone: string;
  email: string;
  username: string;
  password: string;
  commentSuffix: string;
  commentSuffix2: string;
  commissionRate: number;
  isDemo: boolean;
  ticketLetter: string;
};

export function PersonForm({
  initial,
  onSubmit,
  onCancel,
  loading,
  isEdit,
  serverError,
  forManager = false,
  nameLabel = "Nom",
  usernameLabel = "Nom d'utilisateur",
  portalSectionLabel = "Accès portail vendeur",
}: {
  initial?: Partial<{
    name: string;
    phone: string | null;
    email: string | null;
    username: string | null;
    password: string | null;
    commentSuffix: string | null;
    commentSuffix2: string | null;
    commissionRate: number | null;
    isDemo: boolean | null;
    ticketLetter: string | null;
  }>;
  onSubmit: (data: PersonFormData) => void;
  onCancel: () => void;
  loading: boolean;
  isEdit?: boolean;
  serverError?: string;
  forManager?: boolean;
  nameLabel?: string;
  usernameLabel?: string;
  portalSectionLabel?: string;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState(initial?.password ?? "");
  const [commentSuffix, setCommentSuffix] = useState(initial?.commentSuffix ?? "");
  const [commentSuffix2, setCommentSuffix2] = useState(initial?.commentSuffix2 ?? "");
  const [suffixTouched, setSuffixTouched] = useState(!!initial?.commentSuffix);
  const [commissionRate, setCommissionRate] = useState(String(initial?.commissionRate ?? 0));
  const [isDemo, setIsDemo] = useState(initial?.isDemo ?? false);
  const [hasTicketLetter, setHasTicketLetter] = useState(!!initial?.ticketLetter);
  const [ticketLetter, setTicketLetter] = useState(initial?.ticketLetter ?? "");

  const handleNameChange = (v: string) => {
    const upper = forManager ? v : v.toUpperCase();
    setName(upper);
    if (!forManager && !suffixTouched) setCommentSuffix(upper);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ name, phone, email, username, password, commentSuffix, commentSuffix2, commissionRate: Math.min(100, Math.max(0, parseInt(commissionRate || "0", 10) || 0)), isDemo, ticketLetter: hasTicketLetter ? ticketLetter.trim() : "" });
      }}
      className="flex flex-col gap-0"
    >
      {/* Scrollable fields */}
      <div className="overflow-y-auto px-1" style={{ maxHeight: "calc(90vh - 180px)" }}>
        <div className="form-shell space-y-3">
        {serverError && (
          <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            {serverError}
          </div>
        )}

        <div>
          <Label htmlFor="pf-name">{nameLabel} *</Label>
          <Input
            id="pf-name"
            className="mt-1"
            placeholder={forManager ? "ex: Jean Dupont" : "ex: JEAN DUPONT"}
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            required
          />
        </div>

        {!forManager && (
          <>
            <div>
              <Label htmlFor="pf-phone">
                Téléphone <span className="text-gray-400 text-xs">(optionnel)</span>
              </Label>
              <Input
                id="pf-phone"
                className="mt-1"
                placeholder="ex: +225 07 00 00 00"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="pf-email">
                Email <span className="text-gray-400 text-xs">(optionnel)</span>
              </Label>
              <Input
                id="pf-email"
                type="email"
                className="mt-1"
                placeholder="ex: jean@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </>
        )}

        <div className="pt-2 border-t">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            {portalSectionLabel}
          </p>
          <div className="space-y-2">
            <div>
              <Label htmlFor="pf-username">
                {usernameLabel}
                {!forManager && (
                  <span className="text-gray-400 text-xs ml-1">(vide = utilise le téléphone)</span>
                )}
              </Label>
              <Input
                id="pf-username"
                className="mt-1"
                placeholder="ex: jean.dupont"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="pf-password">
                Mot de passe
              </Label>
              <PasswordInput
                id="pf-password"
                className="mt-1"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>
        </div>

        {!forManager && (
          <div className="pt-2 border-t">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Rémunération
            </p>
            <div>
              <Label htmlFor="pf-commission">
                Taux de commission <span className="text-gray-400 text-xs">(% sur les ventes)</span>
              </Label>
              <div className="flex items-center gap-2 mt-1">
                <Input
                  id="pf-commission"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  className="w-24"
                  placeholder="0"
                  value={commissionRate}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "" || (Number(v) >= 0 && Number(v) <= 100)) setCommissionRate(v);
                  }}
                />
                <span className="text-sm text-gray-500">%</span>
                <span className="text-xs text-gray-400 ml-1">(0 = pas de rémunération)</span>
              </div>
            </div>
          </div>
        )}

        {!forManager && (
          <div className="pt-2 border-t flex items-start gap-3 rounded-md border border-orange-200 bg-orange-50 px-3 py-2">
            <input
              id="pf-isdemo"
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-orange-500 cursor-pointer"
              checked={isDemo}
              onChange={(e) => setIsDemo(e.target.checked)}
            />
            <label htmlFor="pf-isdemo" className="cursor-pointer select-none">
              <span className="text-sm font-medium text-orange-800">Vendeur démo (non facturé)</span>
              <p className="text-xs text-orange-600 mt-0.5">
                Les ventes de ce vendeur n'apparaîtront pas dans les rapports et ne seront pas comptabilisées.
              </p>
            </label>
          </div>
        )}

        {!forManager && (
          <div className="pt-2 border-t">
            <div className="flex items-start gap-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
              <input
                id="pf-has-ticket-letter"
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-blue-500 cursor-pointer"
                checked={hasTicketLetter}
                onChange={(e) => setHasTicketLetter(e.target.checked)}
              />
              <label htmlFor="pf-has-ticket-letter" className="cursor-pointer select-none flex-1">
                <span className="text-sm font-medium text-blue-800">Lettre d'identification de ticket</span>
                <p className="text-xs text-blue-600 mt-0.5">
                  Ajoutée automatiquement au préfixe lors de la génération (ex: 1j<strong>k</strong>)
                </p>
              </label>
            </div>
            {hasTicketLetter && (
              <div className="mt-2">
                <Label htmlFor="pf-ticket-letter">Lettre</Label>
                <Input
                  id="pf-ticket-letter"
                  className="mt-1 w-24"
                  placeholder="ex: K"
                  maxLength={3}
                  value={ticketLetter}
                  onChange={(e) => setTicketLetter(e.target.value)}
                />
              </div>
            )}
          </div>
        )}

        {!forManager && (
          <div className="pt-2 border-t">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Identifiants de lot <span className="font-normal normal-case text-gray-400">(optionnels)</span>
            </p>
            <p className="text-xs text-gray-400 mb-2">
              Les vouchers dont le commentaire se termine par l'un de ces identifiants seront automatiquement attribués à ce vendeur.
            </p>
            <div className="space-y-2">
              <div>
                <Label htmlFor="pf-suffix">Identifiant 1</Label>
                <Input
                  id="pf-suffix"
                  className="mt-1 font-mono"
                  placeholder="ex: HOME"
                  value={commentSuffix}
                  onChange={(e) => { setSuffixTouched(true); setCommentSuffix(e.target.value.toUpperCase()); }}
                />
              </div>
              <div>
                <Label htmlFor="pf-suffix2">Identifiant 2</Label>
                <Input
                  id="pf-suffix2"
                  className="mt-1 font-mono"
                  placeholder="ex: BUREAU"
                  value={commentSuffix2}
                  onChange={(e) => setCommentSuffix2(e.target.value.toUpperCase())}
                />
              </div>
            </div>
          </div>
        )}
        </div>
      </div>

      {/* Fixed footer */}
      <DialogFooter className="pt-4 mt-2 border-t">
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Annuler
        </Button>
        <Button type="submit" size="sm" disabled={loading || !name.trim()}>
          {loading ? "Enregistrement..." : "Enregistrer"}
        </Button>
      </DialogFooter>
    </form>
  );
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function getAdminJsonHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token =
    typeof window !== "undefined"
      ? (window.localStorage.getItem("vouchernet_admin_token") ?? window.sessionStorage.getItem("vouchernet_admin_token"))
      : null;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export default function Vendors() {
  const { selectedRouterId } = useRouterContext();
  const { role } = useAuth();
  const isManager = role === "manager";
  const [, navigate] = useLocation();
  const createMutation = useCreateVendor();
  const updateMutation = useUpdateVendor();
  const deleteMutation = useDeleteVendor();
  const queryClient = useQueryClient();
  const authScope = useAuthQueryScope();
  const { toast } = useToast();

  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState<string>("");
  const [editVendor, setEditVendor] = useState<Vendor | null>(null);
  const [editError, setEditError] = useState<string>("");
  const [deleteVendorId, setDeleteVendorId] = useState<number | null>(null);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [showBulkCommission, setShowBulkCommission] = useState(false);
  const [bulkCommissionRate, setBulkCommissionRate] = useState("0");
  const [bulkCommissionLoading, setBulkCommissionLoading] = useState(false);
  const [vendorHotspotProgress, setVendorHotspotProgress] = useState<{ done: number; total: number; enable: boolean } | null>(null);
  const [vendorHotspotPaused, setVendorHotspotPaused] = useState(false);
  const [vendorToggleRunningId, setVendorToggleRunningId] = useState<number | null>(null);

  const handleSync = async (vendor: Vendor) => {
    setSyncingId(vendor.id);
    try {
      const res = await fetch(`${BASE}/api/vendors/${vendor.id}/sync`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({ title: `Synchronisation lancée pour ${vendor.name}`, description: "Les tickets vont être attribués dans quelques secondes." });
      setTimeout(() => invalidate(), 4000);
    } catch {
      toast({ title: "Erreur de synchronisation", variant: "destructive" });
    } finally {
      setSyncingId(null);
    }
  };

  const { data: vendors = [], isLoading, refetch: refetchVendors } = useQuery<Vendor[]>({
    queryKey: ["vendors", selectedRouterId],
    queryFn: withApiPauseCacheFallback(async ({ signal }) => {
      const url = selectedRouterId
        ? `${BASE}/api/vendors?routerId=${selectedRouterId}`
        : `${BASE}/api/vendors`;
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<Vendor[]>;
    }),
    staleTime: 30_000,
  });

  useRefetchOnEmpty(vendors, isLoading, () => void refetchVendors(), (d) => !d || d.length === 0);

  const { data: summaries = [] } = useGetVendorReportsSummary({
    query: {
      queryKey: getGetVendorReportsSummaryQueryKey(),
      staleTime: 60_000,
      queryFn: withApiPauseCacheFallback(({ signal }) => getVendorReportsSummary(undefined, signal)),
    },
  });
  const summaryMap = useMemo(
    () => new Map<number, VendorSummary>(summaries.map((s) => [s.vendor.id, s])),
    [summaries],
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["vendors", selectedRouterId] });
    void refetchVendors();
  };

  const handleCreate = async (data: PersonFormData) => {
    setCreateError("");
    try {
      await createMutation.mutateAsync({
        data: {
          name: data.name,
          phone: data.phone || null,
          email: data.email || null,
          username: data.username || null,
          ...(data.password ? { password: data.password } : {}),
          ...(selectedRouterId ? { routerId: selectedRouterId } : {}),
          ...(data.commentSuffix ? { commentSuffix: data.commentSuffix } : {}),
          ...(data.commentSuffix2 ? { commentSuffix2: data.commentSuffix2 } : {}),
          commissionRate: data.commissionRate,
          isDemo: data.isDemo,
          ticketLetter: data.ticketLetter || null,
        } as any,
      });
      invalidate();
      setShowCreate(false);
      toast({ title: "Vendeur créé avec succès" });
    } catch (err: any) {
      const msg =
        err?.response?.data?.error ??
        err?.message ??
        "Une erreur est survenue";
      setCreateError(msg);
    }
  };

  const handleEdit = async (data: PersonFormData) => {
    if (!editVendor) return;
    setEditError("");
    try {
      await updateMutation.mutateAsync({
        id: editVendor.id,
        data: {
          name: data.name,
          phone: data.phone || null,
          email: data.email || null,
          username: data.username || null,
          ...(data.password ? { password: data.password } : {}),
          commentSuffix: data.commentSuffix || null,
          commentSuffix2: data.commentSuffix2 || null,
          commissionRate: data.commissionRate,
          isDemo: data.isDemo,
          ticketLetter: data.ticketLetter || null,
        } as any,
      });
      invalidate();
      setEditVendor(null);
      toast({ title: "Vendeur mis à jour" });
    } catch (err: any) {
      const msg =
        err?.response?.data?.error ??
        err?.message ??
        "Une erreur est survenue";
      setEditError(msg);
    }
  };

  const handleToggleActive = async (vendor: Vendor) => {
    const nextActive = !vendor.isActive;
    setVendorToggleRunningId(vendor.id);
    try {
      const putRes = await fetch(`${BASE}/api/vendors/${vendor.id}`, {
        method: "PUT",
        headers: getAdminJsonHeaders(),
        body: JSON.stringify({ isActive: nextActive, deferHotspotUserToggle: true }),
      });
      if (!putRes.ok) {
        const j = (await putRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${putRes.status}`);
      }
      const updatedVendor = (await putRes.json()) as Vendor & { routerId?: number | null };
      invalidate();

      const scopeRouterId =
        updatedVendor.routerId ?? selectedRouterId ?? (vendor as Vendor & { routerId?: number }).routerId ?? null;
      const listPath =
        scopeRouterId != null
          ? `${BASE}/api/vendors/${vendor.id}/unsold-vouchers-by-router?routerId=${scopeRouterId}`
          : `${BASE}/api/vendors/${vendor.id}/unsold-vouchers-by-router`;
      const listRes = await fetch(listPath, {
        headers: getAdminJsonHeaders(),
      });
      if (!listRes.ok) {
        throw new Error(`Liste des tickets HTTP ${listRes.status}`);
      }
      const { groups } = (await listRes.json()) as { groups?: Array<{ routerId: number; usernames: string[] }> };
      const plans = groups ?? [];

      await runHotspotUserToggleBatches(BASE, plans, nextActive, {
        onProgress: (p) => setVendorHotspotProgress(p),
        onPaused: setVendorHotspotPaused,
      });

      for (const g of plans) {
        void queryClient.invalidateQueries({
          queryKey: withAuthQueryScope(authScope, [`/routers/${g.routerId}/users`]),
          exact: false,
        });
      }

      toast({
        title: nextActive ? "Vendeur activé" : "Vendeur désactivé",
        description:
          plans.reduce((n, g) => n + g.usernames.length, 0) > 0
            ? "Tickets non vendus synchronisés sur MikroTik."
            : "Aucun ticket non vendu à synchroniser.",
      });
    } catch (e) {
      toast({ title: "Erreur", description: String(e), variant: "destructive" });
      invalidate();
    } finally {
      setVendorToggleRunningId(null);
      setVendorHotspotProgress(null);
      setVendorHotspotPaused(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteVendorId || deleteMutation.isPending) return;
    const deletedId = deleteVendorId;
    try {
      await deleteMutation.mutateAsync({ id: deletedId });
      queryClient.setQueryData<Vendor[]>(["vendors", selectedRouterId], (prev) =>
        Array.isArray(prev) ? prev.filter((v) => v.id !== deletedId) : prev,
      );
      invalidate();
      setDeleteVendorId(null);
      toast({ title: "Vendeur supprimé" });
    } catch {
      toast({ title: "Erreur", description: "Impossible de supprimer le vendeur", variant: "destructive" });
    }
  };

  const handleBulkCommission = async () => {
    if (!selectedRouterId) return;
    setBulkCommissionLoading(true);
    try {
      const rate = Math.min(100, Math.max(0, parseInt(bulkCommissionRate || "0", 10) || 0));
      const res = await fetch(`${BASE}/api/vendors/bulk-commission`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("vouchernet_token")}` },
        body: JSON.stringify({ routerId: selectedRouterId, commissionRate: rate }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Erreur");
      const { updated } = await res.json() as { updated: number };
      invalidate();
      setShowBulkCommission(false);
      toast({ title: `Taux ${rate}% appliqué à ${updated} vendeur${updated !== 1 ? "s" : ""}` });
    } catch (err: any) {
      toast({ title: "Erreur", description: err?.message ?? "Impossible d'appliquer le taux", variant: "destructive" });
    } finally {
      setBulkCommissionLoading(false);
    }
  };

  const handleViewReport = (vendorId: number) => {
    void vendorId; // keep signature; navigation is now always global first
    sessionStorage.removeItem("vouchernet_report_vendor_id");
    navigate("/reports");
  };

  const handleViewDetailedSalesReport = (vendorName: string) => {
    sessionStorage.setItem("vouchernet_sales_report_vendor_name", vendorName);
    navigate("/sales/report");
  };

  const portalBase = import.meta.env.BASE_URL.replace(/\/$/, "");

  return (
    <div>
      {vendorHotspotProgress && (
        <div
          className={`mb-4 rounded-lg border px-3 py-2.5 shadow-sm ${
            vendorHotspotProgress.enable
              ? "border-green-200 bg-green-50/90"
              : "border-orange-200 bg-orange-50/90"
          }`}
        >
          <p
            className={`text-xs font-semibold mb-1.5 ${
              vendorHotspotProgress.enable ? "text-green-900" : "text-orange-900"
            }`}
          >
            {vendorHotspotProgress.enable
              ? "Réactivation des tickets (vendeur)…"
              : "Désactivation des tickets (vendeur)…"}
          </p>
          <div
            className={`relative h-2 bg-white/80 rounded-full overflow-hidden border ${
              vendorHotspotProgress.enable ? "border-green-100" : "border-orange-100"
            }`}
          >
            <div
              className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${
                vendorHotspotPaused
                  ? "bg-amber-400"
                  : vendorHotspotProgress.enable
                    ? "bg-green-600"
                    : "bg-orange-500"
              }`}
              style={{
                width: `${Math.round((vendorHotspotProgress.done / Math.max(1, vendorHotspotProgress.total)) * 100)}%`,
              }}
            />
            {!vendorHotspotPaused && (
              <div
                className="absolute inset-0 animate-shimmer"
                style={{
                  background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.45) 50%, transparent 100%)",
                  backgroundSize: "200% 100%",
                }}
              />
            )}
          </div>
          <div
            className={`flex items-center justify-between text-[11px] mt-1.5 ${
              vendorHotspotProgress.enable ? "text-green-900/80" : "text-orange-900/80"
            }`}
          >
            {vendorHotspotPaused ? (
              <span className="flex items-center gap-1 text-amber-700 font-medium">
                <WifiOff className="h-3 w-3" />
                Routeur inaccessible — reprise automatique…
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <Loader2
                  className={`h-3 w-3 animate-spin ${vendorHotspotProgress.enable ? "text-green-600" : "text-orange-600"}`}
                />
                Envoi vers MikroTik — lots de {TOGGLE_BATCH_SIZE}…
              </span>
            )}
            <span className="tabular-nums font-medium">
              {vendorHotspotProgress.done} / {vendorHotspotProgress.total}
              <span
                className={`font-normal ml-1 ${
                  vendorHotspotProgress.enable ? "text-green-800/70" : "text-orange-700/70"
                }`}
              >
                ({Math.round((vendorHotspotProgress.done / Math.max(1, vendorHotspotProgress.total)) * 100)}%)
              </span>
            </span>
          </div>
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vendeurs</h1>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            className="gap-2"
            title="Portail vendeur"
            onClick={() => window.open(`${portalBase}/vendeur`, "_blank")}
          >
            <ExternalLink className="h-4 w-4" />
            <span className="hidden sm:inline">Portail vendeur</span>
          </Button>
          {!isManager && selectedRouterId && vendors.length > 0 && (
            <Button
              variant="outline"
              className="gap-2"
              title="Taux groupé"
              onClick={() => { setBulkCommissionRate("0"); setShowBulkCommission(true); }}
            >
              <Percent className="h-4 w-4" />
              <span className="hidden sm:inline">Taux groupé</span>
            </Button>
          )}
          {!isManager && (
            <Button
              onClick={() => { setCreateError(""); setShowCreate(true); }}
              className="gap-2"
              title="Ajouter un vendeur"
              disabled={!selectedRouterId}
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Ajouter un vendeur</span>
            </Button>
          )}
        </div>
      </div>

      {!selectedRouterId && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded-lg mb-6 text-sm">
          <Users className="h-4 w-4 flex-shrink-0" />
          Sélectionnez un routeur dans la barre latérale pour afficher et gérer les vendeurs associés.
        </div>
      )}

      {isLoading ? (
        <Card>
          <CardContent className="py-6 space-y-3">
            <Skeleton className="h-5 w-40 mx-auto" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
      ) : vendors.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Users className="h-12 w-12 text-gray-300 mb-4" />
            <p className="text-gray-500 font-medium">Aucun vendeur enregistré</p>
            <p className="text-sm text-gray-400 mt-1">Ajoutez votre premier vendeur pour commencer</p>
            <Button className="mt-4 gap-2" onClick={() => { setCreateError(""); setShowCreate(true); }}>
              <Plus className="h-4 w-4" /> Ajouter un vendeur
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {vendors.map((vendor) => (
            <Card key={vendor.id} className={`hover:shadow-md transition-shadow ${vendor.isActive ? "" : "opacity-60"}`}>
              {/* Partie info — cliquable → rapport vendeur */}
              <CardHeader
                className="pb-3 cursor-pointer group"
                onClick={() => handleViewReport(vendor.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-200 transition-colors">
                      <Users className="h-5 w-5 text-blue-600" />
                    </div>
                    <div className="min-w-0">
                      <CardTitle className="text-base group-hover:text-blue-700 transition-colors truncate">
                        {vendor.name}
                      </CardTitle>
                      {vendor.phone && (
                        <div className="flex items-center gap-1 text-xs text-gray-500 mt-0.5 min-w-0">
                          <Phone className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">{vendor.phone}</span>
                        </div>
                      )}
                      {(vendor as any).email && (
                        <div className="flex items-center gap-1 text-xs text-gray-500 mt-0.5 min-w-0">
                          <Mail className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">{(vendor as any).email}</span>
                        </div>
                      )}
                      {(vendor as any).username && (
                        <div className="flex items-center gap-1 text-xs text-blue-500 mt-0.5 min-w-0">
                          <KeyRound className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">@{(vendor as any).username}</span>
                        </div>
                      )}
                      {((vendor as any).commentSuffix || (vendor as any).commentSuffix2) && (
                        <div className="flex items-center gap-1 text-xs text-orange-500 mt-0.5 min-w-0">
                          <Tag className="h-3 w-3 flex-shrink-0" />
                          <span className="font-mono truncate">
                            {[(vendor as any).commentSuffix, (vendor as any).commentSuffix2]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 items-end flex-shrink-0">
                    <Badge variant={vendor.isActive ? "default" : "secondary"}>
                      {vendor.isActive ? "Actif" : "Inactif"}
                    </Badge>
                    {(vendor as any).isDemo && (
                      <Badge variant="outline" className="text-orange-600 border-orange-300 bg-orange-50 text-[10px] px-1.5">
                        Démo
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>

              {/* Jauge utilisation par vendeur — mois en cours */}
              {(() => {
                const s = summaryMap.get(vendor.id);
                if (!s || s.totalVouchers === 0) return null;
                const monthSold = s.salesStats?.thisMonthSold ?? s.totalUsed;
                const available = s.totalVouchers - s.totalUsed;
                const base      = monthSold + available;
                const soldPct   = base > 0 ? Math.round((monthSold / base) * 100) : 0;
                return (
                  <div className="px-6 pb-3">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-red-600 font-semibold">{monthSold} vendu{monthSold !== 1 ? "s" : ""}</span>
                      <span className="text-gray-400 text-[10px] font-medium uppercase tracking-wide">ce mois</span>
                      <span className="text-green-600 font-semibold">{available} dispo</span>
                    </div>
                    <div className="relative h-2 rounded-full overflow-hidden bg-gray-100">
                      <div
                        className="absolute inset-y-0 left-0 bg-red-400 rounded-l-full transition-all duration-500"
                        style={{ width: `${soldPct}%` }}
                      />
                      <div
                        className="absolute inset-y-0 rounded-full bg-emerald-500 transition-all duration-500"
                        style={{ left: `${soldPct}%`, right: 0 }}
                      />
                    </div>
                  </div>
                );
              })()}

              {/* Boutons d'action visibles */}
              <CardContent className="pt-0">
                <div className="flex flex-wrap gap-2">
                  <div className="flex flex-1 gap-2 min-w-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 gap-1.5 min-w-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50 border-blue-200"
                      onClick={() => handleViewDetailedSalesReport(vendor.name)}
                      title="Ouvrir le rapport de vente détaillé"
                    >
                      <Receipt className="h-3.5 w-3.5 flex-shrink-0" />
                      <span className="truncate">Rapport détaillé</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 gap-1.5 min-w-0"
                      onClick={() => { setEditError(""); setEditVendor(vendor); }}
                    >
                      <Pencil className="h-3.5 w-3.5 flex-shrink-0" />
                      <span className="truncate">Modifier</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className={`flex-1 gap-1.5 min-w-0 ${vendor.isActive
                        ? "text-orange-500 hover:text-orange-700 hover:bg-orange-50 border-orange-200"
                        : "text-green-600 hover:text-green-700 hover:bg-green-50 border-green-200"}`}
                      onClick={() => void handleToggleActive(vendor)}
                      disabled={vendorToggleRunningId !== null}
                      title={vendor.isActive ? "Désactiver" : "Activer"}
                    >
                      {vendor.isActive
                        ? <><X className="h-3.5 w-3.5 flex-shrink-0" /><span className="truncate">Désactiver</span></>
                        : <><Check className="h-3.5 w-3.5 flex-shrink-0" /><span className="truncate">Activer</span></>}
                    </Button>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 text-blue-600 hover:text-blue-700 hover:bg-blue-50 border-blue-200"
                      onClick={() => handleSync(vendor)}
                      disabled={syncingId === vendor.id}
                      title="Resynchroniser les tickets depuis MikroTik"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${syncingId === vendor.id ? "animate-spin" : ""}`} />
                    </Button>
                    {!isManager && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                        onClick={() => setDeleteVendorId(vendor.id)}
                        disabled={deleteMutation.isPending && deleteVendorId === vendor.id}
                        title="Supprimer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={(o) => { if (!o) { setShowCreate(false); setCreateError(""); } }}>
        <DialogContent className="max-w-md w-full sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Ajouter un vendeur</DialogTitle>
          </DialogHeader>
          <PersonForm
            onSubmit={handleCreate}
            onCancel={() => { setShowCreate(false); setCreateError(""); }}
            loading={createMutation.isPending}
            serverError={createError}
            nameLabel="Nom du vendeur"
          />
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editVendor} onOpenChange={(o) => { if (!o) { setEditVendor(null); setEditError(""); } }}>
        <DialogContent className="max-w-md w-full sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Modifier le vendeur</DialogTitle>
          </DialogHeader>
          {editVendor && (
            <PersonForm
              initial={{
                name: editVendor.name,
                phone: editVendor.phone ?? null,
                email: (editVendor as any).email ?? null,
                username: (editVendor as any).username ?? null,
                password: (editVendor as any).passwordPlain ?? (editVendor as any).password ?? null,
                commentSuffix: (editVendor as any).commentSuffix ?? null,
                commentSuffix2: (editVendor as any).commentSuffix2 ?? null,
                commissionRate: (editVendor as any).commissionRate ?? 0,
                isDemo: (editVendor as any).isDemo ?? false,
                ticketLetter: (editVendor as any).ticketLetter ?? null,
              }}
              onSubmit={handleEdit}
              onCancel={() => { setEditVendor(null); setEditError(""); }}
              loading={updateMutation.isPending}
              isEdit
              serverError={editError}
              nameLabel="Nom du vendeur"
            />
          )}
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={!!deleteVendorId}
        onOpenChange={(o) => { if (!o && !deleteMutation.isPending) setDeleteVendorId(null); }}
        title="Supprimer ce vendeur ?"
        description="Cette action est irréversible. Les vouchers attribués à ce vendeur ne seront plus liés à lui."
        onConfirm={handleDelete}
        loading={deleteMutation.isPending}
      />

      {/* Bulk commission dialog */}
      <Dialog open={showBulkCommission} onOpenChange={(o) => { if (!o) setShowBulkCommission(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Percent className="h-4 w-4 text-violet-600" />
              Taux de commission groupé
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-gray-600">
              Applique le même taux de commission à <span className="font-semibold">tous les vendeurs</span> du routeur sélectionné ({vendors.length} vendeur{vendors.length !== 1 ? "s" : ""}).
            </p>
            <div>
              <Label htmlFor="bulk-rate">Taux de commission</Label>
              <div className="flex items-center gap-2 mt-1">
                <Input
                  id="bulk-rate"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  className="w-24"
                  placeholder="0"
                  value={bulkCommissionRate}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "" || (Number(v) >= 0 && Number(v) <= 100)) setBulkCommissionRate(v);
                  }}
                />
                <span className="text-sm text-gray-500">%</span>
              </div>
              <p className="text-xs text-gray-400 mt-1">0 = aucune rémunération</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkCommission(false)} disabled={bulkCommissionLoading}>
              Annuler
            </Button>
            <Button onClick={handleBulkCommission} disabled={bulkCommissionLoading} className="gap-2">
              {bulkCommissionLoading ? "Enregistrement..." : `Appliquer à tous`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
