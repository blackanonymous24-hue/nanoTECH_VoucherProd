import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileCode, Save, Loader2, RotateCcw, Router } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  DEFAULT_TICKET_PRESET_ID,
  type TicketTemplatePresetId,
  type TicketTemplateSelectionId,
  getPresetBody,
  setStoredTicketPresetId,
  findMatchingPresetId,
  resolveTicketTemplateSelection,
  resolveTicketTemplateDisplayBody,
  fetchAndApplyServerTicketTemplates,
  subscribeServerTicketTemplates,
  getEffectiveTicketTemplatePresets,
  type TicketTemplatePreset,
} from "@/lib/voucher-ticket-presets";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { TicketPhpEditor } from "@/components/TicketPhpEditor";
import { VoucherPrintScaleButton } from "@/components/VoucherPrintScaleButton";
import { VoucherPrintScaleBroadcastButton } from "@/components/VoucherPrintScaleBroadcastButton";
import { BuiltinTicketTemplatesManager } from "@/components/BuiltinTicketTemplatesManager";
import { setCurrentPrintTemplateId } from "@/lib/voucher-print-scale";
import {
  TICKET_TEMPLATE_VAR_REFERENCE,
  TICKET_TEMPLATE_VAR_REFERENCE_CONDITIONAL,
} from "@/lib/ticket-template-vars";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type TicketTemplateEditorProps = {
  loadPath: string;
  savePath: string;
  authHeaders: Record<string, string>;
  /** Édition d’un autre admin (super-admin) : pas de localStorage partagé */
  isolatedScope?: boolean;
  layout: "page" | "dialog";
  title: string;
  subtitle?: string;
  enabled?: boolean;
  onClose?: () => void;
  onSaved?: () => void;
  showBroadcastScale?: boolean;
  /** Affiche le panneau super-admin (import / suppression de modèles intégrés). */
  showBuiltinTemplatesManager?: boolean;
};

export function TicketTemplateEditor({
  loadPath,
  savePath,
  authHeaders,
  isolatedScope = false,
  layout,
  title,
  subtitle,
  enabled = true,
  onClose,
  onSaved,
  showBroadcastScale = false,
  showBuiltinTemplatesManager = false,
}: TicketTemplateEditorProps) {
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [presetValue, setPresetValue] = useState<TicketTemplateSelectionId>("mikhmon-small");
  const [editorEpoch, setEditorEpoch] = useState(0);
  const templateCardRef = useRef<HTMLDivElement>(null);
  const loadRequestRef = useRef(0);
  const [templateCardHeight, setTemplateCardHeight] = useState<number | undefined>(undefined);
  const [syncVarsCardHeight, setSyncVarsCardHeight] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [effectivePresets, setEffectivePresets] = useState<TicketTemplatePreset[]>(() =>
    getEffectiveTicketTemplatePresets(),
  );

  useEffect(() => {
    setCurrentPrintTemplateId(presetValue);
  }, [presetValue]);

  useEffect(() => {
    if (!enabled) return;
    void fetchAndApplyServerTicketTemplates(authHeaders);
    const unsub = subscribeServerTicketTemplates(() => {
      setEffectivePresets(getEffectiveTicketTemplatePresets());
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setSyncVarsCardHeight(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const node = templateCardRef.current;
    if (!node) return;
    const measure = () => setTemplateCardHeight(node.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [loading, code]);

  const syncLocalPreset = useCallback(
    (id: TicketTemplateSelectionId) => {
      if (!isolatedScope) setStoredTicketPresetId(id);
    },
    [isolatedScope],
  );

  const loadTemplateFromServer = useCallback(async (): Promise<boolean> => {
    if (!enabled) {
      setLoading(false);
      setCode("");
      setDirty(false);
      return false;
    }
    const reqId = ++loadRequestRef.current;
    setLoading(true);
    try {
      const r = await fetch(`${BASE}${loadPath}`, { headers: authHeaders });
      const data = (r.ok ? await r.json() : { template: null, presetId: null }) as {
        template: string | null;
        presetId?: string | null;
      };
      if (reqId !== loadRequestRef.current) return false;
      const fromServer = data.template ?? "";
      const resolvedPreset = resolveTicketTemplateSelection({
        templateBody: fromServer,
        serverPresetId: data.presetId,
        skipLocalFallback: isolatedScope,
      });
      const display = resolveTicketTemplateDisplayBody(fromServer, resolvedPreset);
      setCode(display);
      setPresetValue(resolvedPreset);
      syncLocalPreset(resolvedPreset);
      setDirty(false);
      setEditorEpoch((n) => n + 1);
      return true;
    } catch {
      if (reqId !== loadRequestRef.current) return false;
      toast({
        title: "Chargement impossible",
        description: "Le modèle enregistré n'a pas pu être récupéré.",
        variant: "destructive",
      });
      return false;
    } finally {
      if (reqId === loadRequestRef.current) setLoading(false);
    }
  }, [authHeaders, enabled, isolatedScope, loadPath, syncLocalPreset, toast]);

  useEffect(() => {
    void loadTemplateFromServer();
  }, [loadTemplateFromServer]);

  const persistTemplate = async (
    template: string,
    presetForApi: TicketTemplateSelectionId,
  ): Promise<boolean> => {
    if (!enabled) return false;
    setSaving(true);
    try {
      const r = await fetch(`${BASE}${savePath}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ template, presetId: presetForApi }),
      });
      if (r.ok) {
        setDirty(false);
        setPresetValue(presetForApi);
        syncLocalPreset(presetForApi);
        onSaved?.();
        return true;
      }
      const err = (await r.json().catch(() => ({}))) as { error?: string };
      toast({
        title: "Erreur",
        description: err.error ?? "Sauvegarde impossible.",
        variant: "destructive",
      });
      return false;
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    const body =
      presetValue !== "custom" && !code.trim()
        ? getPresetBody(presetValue)
        : code;
    const ok = await persistTemplate(body, presetValue);
    if (ok) {
      setCode(body);
      toast({
        title: "Modèle enregistré",
        description: isolatedScope
          ? "Modèle synchronisé sur le compte administrateur cible."
          : "Synchronisé sur le serveur pour ce compte administrateur.",
      });
      if (layout === "dialog") onClose?.();
    }
  };

  const handlePresetChange = (v: string) => {
    if (v === "custom") {
      syncLocalPreset("custom");
      setPresetValue("custom");
      return;
    }
    const id = v as TicketTemplatePresetId;
    const body = getPresetBody(id);
    syncLocalPreset(id);
    setPresetValue(id);
    setCode(body);
    setDirty(true);
    setEditorEpoch((n) => n + 1);
    const label = effectivePresets.find((p) => p.id === id)?.label ?? id;
    toast({
      title: "Modèle intégré chargé",
      description: `${label} — enregistrez pour l’appliquer${isolatedScope ? " à cet admin" : " en base"}.`,
    });
  };

  const isCustomTemplate = useMemo(() => !loading && presetValue === "custom", [loading, presetValue]);

  const needsResetConfirm =
    dirty && findMatchingPresetId(code) !== DEFAULT_TICKET_PRESET_ID;

  const executeReset = async () => {
    const body = getPresetBody(DEFAULT_TICKET_PRESET_ID);
    syncLocalPreset(DEFAULT_TICKET_PRESET_ID);
    setPresetValue(DEFAULT_TICKET_PRESET_ID);
    setCode(body);
    setEditorEpoch((n) => n + 1);
    const saved = await persistTemplate(body, DEFAULT_TICKET_PRESET_ID);
    if (saved) {
      toast({
        title: "Réinitialisé",
        description: "Modèle Mikhmon (small) enregistré sur le serveur.",
      });
    } else {
      setDirty(true);
    }
  };

  const handleResetClick = () => {
    if (needsResetConfirm) {
      setResetConfirmOpen(true);
      return;
    }
    void executeReset();
  };

  const editorBlock = (
    <div className="flex flex-col lg:flex-row gap-3 items-start">
      <Card ref={templateCardRef} className="flex-1 min-w-0 w-full shadow-sm">
        <CardHeader className="py-2 px-3 sm:px-4 space-y-1.5">
          <div className="space-y-0.5 w-full">
            <div className="flex flex-wrap items-end justify-between gap-x-2 gap-y-1.5 w-full">
              <div className="flex items-end gap-2 min-w-0">
                <div className="flex flex-col gap-0.5 min-w-0">
                  <Label className="text-[10px] font-medium text-gray-600 flex items-center gap-1">
                    <Router className="h-3 w-3 text-gray-400 shrink-0" />
                    Modèle intégré
                  </Label>
                  <Select
                    value={presetValue}
                    onValueChange={handlePresetChange}
                    disabled={loading || !enabled || saving}
                  >
                    <SelectTrigger className="h-7 w-full sm:w-[11.5rem] text-xs px-2 py-0 bg-white border-gray-200 shadow-none [&_svg]:h-3 [&_svg]:w-3">
                      <SelectValue placeholder="Choisir…" />
                    </SelectTrigger>
                    <SelectContent className="text-xs">
                      {effectivePresets.map(({ id, label }) => (
                        <SelectItem key={id} value={id} className="text-xs py-1 pl-2 pr-7 min-h-0">
                          {label}
                        </SelectItem>
                      ))}
                      {isCustomTemplate ? (
                        <SelectItem
                          value="custom"
                          className="text-[11px] text-muted-foreground py-1 pl-2 pr-7 min-h-0"
                        >
                          Personnalisé
                        </SelectItem>
                      ) : null}
                    </SelectContent>
                  </Select>
                </div>
                {isCustomTemplate ? (
                  <Button
                    type="button"
                    variant="warning"
                    size="sm"
                    onClick={handleResetClick}
                    disabled={saving || loading || !enabled}
                    className="shrink-0"
                  >
                    {saving ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                    Réinitialiser
                  </Button>
                ) : null}
              </div>
              <div className="flex items-center gap-1 shrink-0 ml-auto">
                <VoucherPrintScaleButton templateId={presetValue} compact />
                {layout === "page" ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={saving || loading || !enabled}
                    onClick={() => void handleSave()}
                  >
                    {saving ? <Loader2 className="animate-spin" /> : <Save />}
                    Sauvegarder
                  </Button>
                ) : null}
              </div>
            </div>
            {isCustomTemplate && (
              <p className="text-[10px] leading-snug text-amber-700/90 max-w-md">
                Contenu hors modèles intégrés — choisissez un modèle ci-dessus ou continuez à éditer.
              </p>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-0 pb-2 px-3 sm:px-4 sm:pb-3">
          <CardTitle className="text-xs font-semibold text-gray-800 mb-1.5">Éditeur</CardTitle>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Chargement…
            </div>
          ) : (
            <TicketPhpEditor
              key={editorEpoch}
              value={code}
              onChange={(next) => {
                setCode(next);
                setDirty(true);
                setPresetValue(findMatchingPresetId(next));
              }}
              readOnly={!enabled}
              placeholder="Choisissez un modèle intégré ou collez votre template PHP…"
              editorMinHeight={layout === "dialog" ? "min(42vh, 420px)" : "min(52vh, 500px)"}
            />
          )}
        </CardContent>
      </Card>

      <Card
        className="w-full lg:w-64 xl:w-72 shrink-0 flex flex-col overflow-hidden shadow-sm"
        style={
          syncVarsCardHeight && templateCardHeight != null
            ? { height: templateCardHeight }
            : undefined
        }
      >
        <CardHeader className="py-2 px-3 pb-1 space-y-0">
          <CardTitle className="text-xs font-semibold text-violet-900 leading-tight">
            Variables PHP
          </CardTitle>
          <p className="text-[10px] text-violet-700/75 leading-snug">Référence MikHmon</p>
        </CardHeader>
        <CardContent className="pt-0 pb-2 px-3 flex-1 min-h-0 overflow-y-auto">
          <ul className="space-y-2">
            {TICKET_TEMPLATE_VAR_REFERENCE.map(({ title: varTitle, code: varCode }) => (
              <li
                key={varTitle}
                className="rounded-md border border-violet-100/90 bg-violet-50/50 px-2 py-1.5 text-[10px] text-violet-950/90"
              >
                <p className="font-semibold text-violet-900 mb-0.5">{varTitle} :</p>
                <pre className="whitespace-pre-wrap break-all font-mono text-[9px] leading-relaxed text-violet-950/85 bg-white/80 rounded px-1 py-0.5 m-0">
                  {varCode}
                </pre>
              </li>
            ))}
            <li className="rounded-md border border-violet-100/90 bg-violet-50/50 px-2 py-1.5 text-[10px] text-violet-950/90">
              <p className="font-semibold text-violet-900 mb-0.5">
                {TICKET_TEMPLATE_VAR_REFERENCE_CONDITIONAL.title} :
              </p>
              <pre className="whitespace-pre-wrap font-mono text-[9px] leading-relaxed text-violet-950/85 bg-white/80 rounded px-1 py-0.5 m-0">
                {TICKET_TEMPLATE_VAR_REFERENCE_CONDITIONAL.body}
              </pre>
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );

  const resetDialog = (
    <DeleteConfirmDialog
      open={resetConfirmOpen}
      onOpenChange={(o) => {
        if (!o && !saving) setResetConfirmOpen(false);
      }}
      icon="warning"
      title="Réinitialiser le modèle ?"
      description="Réappliquer le modèle intégré Mikhmon (small) ? Les modifications non enregistrées seront perdues."
      onConfirm={() => {
        setResetConfirmOpen(false);
        void executeReset();
      }}
      loading={saving}
      confirmLabel="Réinitialiser"
    />
  );

  if (layout === "dialog") {
    return (
      <>
        <Dialog open onOpenChange={(o) => { if (!o) onClose?.(); }}>
          <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileCode className="h-5 w-5 text-violet-600" />
                {title}
              </DialogTitle>
              {subtitle ? <DialogDescription>{subtitle}</DialogDescription> : null}
            </DialogHeader>
            {editorBlock}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={onClose} disabled={saving}>
                Annuler
              </Button>
              <Button disabled={saving || loading || !enabled} onClick={() => void handleSave()}>
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Sauvegarde…
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Sauvegarder
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {resetDialog}
      </>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-2 p-3 md:p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <div className="min-w-0">
          <h1 className="text-base font-bold text-gray-900 flex items-center gap-1.5">
            <FileCode className="h-4 w-4 text-violet-600" />
            {title}
          </h1>
          {subtitle ? (
            <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">{subtitle}</p>
          ) : null}
        </div>
        {showBroadcastScale ? (
          <VoucherPrintScaleBroadcastButton templateId={presetValue} />
        ) : null}
      </div>
      {showBuiltinTemplatesManager ? (
        <BuiltinTicketTemplatesManager
          authHeaders={authHeaders}
          onTemplatesChanged={() => {
            setEffectivePresets(getEffectiveTicketTemplatePresets());
          }}
        />
      ) : null}
      {editorBlock}
      {resetDialog}
    </div>
  );
}