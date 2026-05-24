import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Upload, Trash2, Loader2, RotateCcw, Plus, FileCode2, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  FACTORY_TICKET_PRESET_IDS,
  fetchAndApplyServerTicketTemplates,
  getEffectiveTicketTemplatePresets,
  setServerTicketTemplates,
  subscribeServerTicketTemplates,
  type TicketTemplatePreset,
} from "@/lib/voucher-ticket-presets";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const MAX_BODY_BYTES = 256 * 1024;
const MAX_LABEL = 80;
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-_]{0,62}[a-z0-9])?$/;

type BuiltinTicketTemplatesManagerProps = {
  authHeaders: Record<string, string>;
  /** Notifie le parent qu'un changement (import / suppression) a eu lieu — pour réordonner le menu déroulant. */
  onTemplatesChanged?: () => void;
};

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function BuiltinTicketTemplatesManager({
  authHeaders,
  onTemplatesChanged,
}: BuiltinTicketTemplatesManagerProps) {
  const { toast } = useToast();
  const [presets, setPresets] = useState<TicketTemplatePreset[]>(() => getEffectiveTicketTemplatePresets());
  const [importOpen, setImportOpen] = useState(false);
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TicketTemplatePreset | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const unsub = subscribeServerTicketTemplates(() => {
      setPresets(getEffectiveTicketTemplatePresets());
    });
    return unsub;
  }, []);

  useEffect(() => {
    void fetchAndApplyServerTicketTemplates(authHeaders);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleImportClick = () => {
    setEditingPresetId(null);
    setImportOpen(true);
  };

  const handleReplaceClick = (preset: TicketTemplatePreset) => {
    setEditingPresetId(preset.id);
    setImportOpen(true);
  };

  const handleDeleteClick = (preset: TicketTemplatePreset) => {
    if (!preset.serverId) return;
    setDeleteTarget(preset);
  };

  const executeDelete = async () => {
    if (!deleteTarget?.serverId) return;
    setDeleting(true);
    try {
      const r = await fetch(`${BASE}/api/super/builtin-templates/${deleteTarget.serverId}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { error?: string };
        toast({
          title: "Suppression impossible",
          description: err.error ?? "Erreur serveur.",
          variant: "destructive",
        });
        return;
      }
      await fetchAndApplyServerTicketTemplates(authHeaders);
      onTemplatesChanged?.();
      toast({
        title: deleteTarget.isFactorySlug ? "Surcharge supprimée" : "Modèle supprimé",
        description: deleteTarget.isFactorySlug
          ? `« ${deleteTarget.label} » est revenu au modèle d'usine embarqué.`
          : `« ${deleteTarget.label} » a été retiré de tous les comptes.`,
      });
      setDeleteTarget(null);
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Card className="border-violet-100/80 shadow-sm">
        <CardHeader className="py-2.5 px-3 sm:px-4 flex flex-row items-center justify-between gap-2 space-y-0">
          <div className="min-w-0">
            <CardTitle className="text-xs font-semibold text-violet-900 flex items-center gap-1.5">
              <Server className="h-3.5 w-3.5 text-violet-600" />
              Modèles intégrés partagés
            </CardTitle>
            <p className="text-[10px] text-violet-700/80 leading-snug mt-0.5">
              Liste diffusée à <strong>tous les comptes</strong>. Importez un fichier pour
              ajouter ou remplacer un modèle, supprimez pour le retirer chez tout le monde.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0 gap-1.5"
            onClick={handleImportClick}
            disabled={busy}
          >
            <Plus className="h-3.5 w-3.5" />
            Importer un modèle
          </Button>
        </CardHeader>
        <CardContent className="pt-0 pb-2.5 px-3 sm:px-4">
          <ul className="space-y-1.5">
            {presets.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-2 rounded-md border border-violet-100/70 bg-violet-50/40 px-2.5 py-1.5"
              >
                <div className="min-w-0 flex items-center gap-2">
                  <FileCode2 className="h-3.5 w-3.5 text-violet-500 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-violet-950 truncate">{p.label}</div>
                    <div className="text-[10px] font-mono text-violet-700/70 truncate">{p.id}</div>
                  </div>
                  {p.isFactorySlug ? (
                    <Badge variant="outline" className="h-5 px-1.5 text-[9px] font-medium shrink-0">
                      {p.isManaged ? "Usine — surchargé" : "Usine"}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="h-5 px-1.5 text-[9px] font-medium shrink-0">
                      Super-admin
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    title={
                      p.isFactorySlug
                        ? "Remplacer le contenu d'usine (importer un nouveau fichier)"
                        : "Remplacer le contenu du modèle"
                    }
                    onClick={() => handleReplaceClick(p)}
                    disabled={busy}
                  >
                    <Upload className="h-3.5 w-3.5" />
                  </Button>
                  {p.isManaged ? (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-red-600 hover:text-red-700"
                      title={
                        p.isFactorySlug
                          ? "Supprimer la surcharge (retour au modèle d'usine embarqué)"
                          : "Supprimer ce modèle pour tous les comptes"
                      }
                      onClick={() => handleDeleteClick(p)}
                      disabled={busy}
                    >
                      {p.isFactorySlug ? <RotateCcw className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-muted-foreground mt-2 leading-snug">
            Slugs réservés : <code className="font-mono">mikhmon-small</code>,{" "}
            <code className="font-mono">nanotech-normal</code>,{" "}
            <code className="font-mono">nanotech-small</code> (modèles d'usine — supprimables
            uniquement après avoir été surchargés).
          </p>
        </CardContent>
      </Card>

      {importOpen ? (
        <ImportTemplateDialog
          open={importOpen}
          onOpenChange={(o) => {
            if (!busy) setImportOpen(o);
            if (!o) setEditingPresetId(null);
          }}
          authHeaders={authHeaders}
          editingPresetId={editingPresetId}
          onBusyChange={setBusy}
          onSuccess={async () => {
            await fetchAndApplyServerTicketTemplates(authHeaders);
            onTemplatesChanged?.();
          }}
        />
      ) : null}

      <DeleteConfirmDialog
        open={deleteTarget != null}
        onOpenChange={(o) => {
          if (!o && !deleting) setDeleteTarget(null);
        }}
        icon={deleteTarget?.isFactorySlug ? "warning" : "trash"}
        title={
          deleteTarget?.isFactorySlug
            ? "Restaurer le modèle d'usine ?"
            : "Supprimer ce modèle ?"
        }
        description={
          deleteTarget?.isFactorySlug
            ? `« ${deleteTarget?.label ?? ""} » repassera au modèle embarqué d'origine pour tous les comptes.`
            : `« ${deleteTarget?.label ?? ""} » disparaîtra du menu pour tous les comptes. Les comptes qui l'avaient sauvegardé conservent leur copie locale.`
        }
        confirmLabel={deleteTarget?.isFactorySlug ? "Restaurer" : "Supprimer"}
        loading={deleting}
        onConfirm={() => void executeDelete()}
      />
    </>
  );
}

// ----------------------------------------------------------------------------
// Dialogue d'import / remplacement d'un modèle
// ----------------------------------------------------------------------------

type ImportTemplateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  authHeaders: Record<string, string>;
  editingPresetId: string | null;
  onBusyChange: (busy: boolean) => void;
  onSuccess: () => Promise<void> | void;
};

function ImportTemplateDialog({
  open,
  onOpenChange,
  authHeaders,
  editingPresetId,
  onBusyChange,
  onSuccess,
}: ImportTemplateDialogProps) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [label, setLabel] = useState("");
  const [body, setBody] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const editingPreset = useMemo(() => {
    if (!editingPresetId) return null;
    return getEffectiveTicketTemplatePresets().find((p) => p.id === editingPresetId) ?? null;
  }, [editingPresetId]);

  useEffect(() => {
    if (!open) return;
    if (editingPreset) {
      setSlug(editingPreset.id);
      setLabel(editingPreset.label);
      setSlugTouched(true);
    } else {
      setSlug("");
      setLabel("");
      setSlugTouched(false);
    }
    setBody("");
    setFileName(null);
  }, [open, editingPreset]);

  const handleLabelChange = (next: string) => {
    setLabel(next);
    if (!editingPreset && !slugTouched) setSlug(slugify(next));
  };

  const handleSlugChange = (next: string) => {
    setSlugTouched(true);
    setSlug(next.toLowerCase().replace(/[^a-z0-9-_]/g, ""));
  };

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > MAX_BODY_BYTES) {
        toast({
          title: "Fichier trop volumineux",
          description: `Limite : ${MAX_BODY_BYTES / 1024} Ko.`,
          variant: "destructive",
        });
        e.target.value = "";
        return;
      }
      try {
        const text = await file.text();
        setBody(text);
        setFileName(file.name);
        if (!editingPreset && !label.trim()) {
          const guessedLabel = file.name.replace(/\.(php|txt|html?)$/i, "").trim();
          if (guessedLabel) handleLabelChange(guessedLabel);
        }
      } catch {
        toast({ title: "Lecture impossible", variant: "destructive" });
      } finally {
        e.target.value = "";
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editingPreset, label],
  );

  const isFactorySlug = useMemo(() => FACTORY_TICKET_PRESET_IDS.includes(slug as never), [slug]);
  const slugValid = slug.length > 0 && SLUG_PATTERN.test(slug) && slug !== "custom";
  const labelValid = label.trim().length > 0 && label.trim().length <= MAX_LABEL;
  const bodyValid = body.trim().length > 0 && body.length <= MAX_BODY_BYTES;
  const canSubmit = slugValid && labelValid && bodyValid && !saving;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    onBusyChange(true);
    try {
      const r = await fetch(`${BASE}/api/super/builtin-templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ slug, label: label.trim(), body }),
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { error?: string };
        toast({
          title: "Import impossible",
          description: err.error ?? "Erreur serveur.",
          variant: "destructive",
        });
        return;
      }
      await onSuccess();
      toast({
        title: editingPreset ? "Modèle remplacé" : "Modèle importé",
        description: `« ${label.trim()} » est désormais disponible pour tous les comptes.`,
      });
      onOpenChange(false);
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
    } finally {
      setSaving(false);
      onBusyChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Upload className="h-4 w-4 text-violet-600" />
            {editingPreset
              ? `Remplacer le contenu de « ${editingPreset.label} »`
              : "Importer un nouveau modèle intégré"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Le fichier PHP/HTML sera disponible immédiatement comme « Modèle intégré » dans
            tous les comptes administrateurs. Taille max : {MAX_BODY_BYTES / 1024} Ko.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="space-y-1">
            <Label htmlFor="builtin-tpl-label" className="text-xs">
              Libellé (affiché dans le menu)
            </Label>
            <Input
              id="builtin-tpl-label"
              value={label}
              maxLength={MAX_LABEL}
              onChange={(e) => handleLabelChange(e.target.value)}
              placeholder="Ex : Mikhmon (gros caractères)"
              disabled={saving}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="builtin-tpl-slug" className="text-xs">
              Identifiant (slug) — immuable
            </Label>
            <Input
              id="builtin-tpl-slug"
              value={slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              placeholder="mikhmon-large"
              disabled={saving || !!editingPreset}
              className="font-mono text-xs"
            />
            {slug && !slugValid ? (
              <p className="text-[10px] text-red-600 leading-snug">
                Slug invalide : minuscules, chiffres, « - » ou « _ », 1 à 64 caractères.
              </p>
            ) : null}
            {isFactorySlug && !editingPreset ? (
              <p className="text-[10px] text-amber-700 leading-snug">
                Ce slug est un modèle d'usine — importer écrasera le contenu embarqué pour
                tous les comptes (réversible : la suppression restaure le default).
              </p>
            ) : null}
          </div>

          <div className="space-y-1">
            <Label htmlFor="builtin-tpl-file" className="text-xs">
              Fichier PHP / HTML
            </Label>
            <Input
              id="builtin-tpl-file"
              ref={fileRef}
              type="file"
              accept=".php,.txt,.html,.htm,text/*,application/x-php"
              onChange={(e) => void handleFileChange(e)}
              disabled={saving}
              className="cursor-pointer file:cursor-pointer"
            />
            {fileName ? (
              <p className="text-[11px] text-muted-foreground leading-snug">
                Sélectionné : <span className="font-mono">{fileName}</span> ·{" "}
                {Math.ceil(new Blob([body]).size / 1024)} Ko
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground leading-snug">
                Aucun fichier sélectionné — vous pouvez aussi coller le contenu ci-dessous.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="builtin-tpl-body" className="text-xs">
              Contenu PHP / HTML (édition manuelle facultative)
            </Label>
            <textarea
              id="builtin-tpl-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="<?php ..."
              rows={6}
              disabled={saving}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-[11px] font-mono shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Annuler
          </Button>
          <Button size="sm" disabled={!canSubmit} onClick={() => void handleSubmit()}>
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Envoi…
              </>
            ) : editingPreset ? (
              "Remplacer"
            ) : (
              "Importer"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Petit utilitaire pour forcer un rafraîchissement externe sans dépendances circulaires. */
export async function refreshBuiltinTemplatesCache(
  authHeaders: Record<string, string>,
): Promise<void> {
  await fetchAndApplyServerTicketTemplates(authHeaders);
}

/** Réinitialise le registre local (utile au logout). */
export function clearBuiltinTemplatesCache(): void {
  setServerTicketTemplates([]);
}
