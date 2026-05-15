import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileCode, Save, Loader2, RotateCcw, Router } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  TICKET_TEMPLATE_PRESETS,
  DEFAULT_TICKET_PRESET_ID,
  type TicketTemplatePresetId,
  getPresetBody,
  getStoredTicketPresetId,
  setStoredTicketPresetId,
  findMatchingPresetId,
} from "@/lib/voucher-ticket-presets";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { TicketPhpEditor } from "@/components/TicketPhpEditor";
import { VoucherPrintScaleButton } from "@/components/VoucherPrintScaleButton";
import { VoucherPrintScaleBroadcastButton } from "@/components/VoucherPrintScaleBroadcastButton";
import { setCurrentPrintTemplateId } from "@/lib/voucher-print-scale";
import {
  TICKET_TEMPLATE_VAR_REFERENCE,
  TICKET_TEMPLATE_VAR_REFERENCE_CONDITIONAL,
} from "@/lib/ticket-template-vars";
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function TicketTemplate() {
  const { token } = useAuth();
  const { toast } = useToast();
  const authHeaders = { Authorization: `Bearer ${token ?? ""}` };
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [presetValue, setPresetValue] = useState<TicketTemplatePresetId | "custom">("mikhmon-small");
  const [editorEpoch, setEditorEpoch] = useState(0);
  const templateCardRef = useRef<HTMLDivElement>(null);
  const loadRequestRef = useRef(0);
  const [templateCardHeight, setTemplateCardHeight] = useState<number | undefined>(undefined);
  const [syncVarsCardHeight, setSyncVarsCardHeight] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  useEffect(() => { setCurrentPrintTemplateId(presetValue); }, [presetValue]);

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

  const loadTemplateFromServer = useCallback(async (): Promise<boolean> => {
    if (!token) {
      setLoading(false);
      setCode("");
      setDirty(false);
      return false;
    }
    const reqId = ++loadRequestRef.current;
    setLoading(true);
    try {
      const r = await fetch(`${BASE}/api/admin/ticket-template`, { headers: authHeaders });
      const data = (r.ok ? await r.json() : { template: null }) as { template: string | null };
      if (reqId !== loadRequestRef.current) return false;
      const fromServer = data.template ?? "";
      setCode(fromServer);
      setPresetValue(
        fromServer.trim() ? findMatchingPresetId(fromServer) : getStoredTicketPresetId(),
      );
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    void loadTemplateFromServer();
  }, [loadTemplateFromServer]);

  const persistTemplate = async (template: string): Promise<boolean> => {
    if (!token) return false;
    setSaving(true);
    try {
      const r = await fetch(`${BASE}/api/admin/ticket-template`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ template }),
      });
      if (r.ok) {
        setDirty(false);
        setPresetValue(findMatchingPresetId(template));
        return true;
      }
      const err = await r.json().catch(() => ({})) as { error?: string };
      toast({ title: "Erreur", description: err.error ?? "Sauvegarde impossible.", variant: "destructive" });
      return false;
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    const ok = await persistTemplate(code);
    if (ok) {
      toast({ title: "Modèle enregistré", description: "Synchronisé sur le serveur pour ce compte administrateur." });
    }
  };

  const handlePresetChange = (v: string) => {
    if (v === "custom") {
      setPresetValue("custom");
      return;
    }
    const id = v as TicketTemplatePresetId;
    const body = getPresetBody(id);
    setStoredTicketPresetId(id);
    setPresetValue(id);
    setCode(body);
    setDirty(true);
    setEditorEpoch((n) => n + 1);
    const label = TICKET_TEMPLATE_PRESETS.find((p) => p.id === id)?.label ?? id;
    toast({ title: "Modèle intégré chargé", description: `${label} — enregistrez pour le conserver en base.` });
  };

  const isCustomTemplate = useMemo(
    () => !loading && findMatchingPresetId(code) === "custom",
    [loading, code],
  );

  const needsResetConfirm =
    dirty && findMatchingPresetId(code) !== DEFAULT_TICKET_PRESET_ID;

  const executeReset = async () => {
    const body = getPresetBody(DEFAULT_TICKET_PRESET_ID);
    setStoredTicketPresetId(DEFAULT_TICKET_PRESET_ID);
    setPresetValue(DEFAULT_TICKET_PRESET_ID);
    setCode(body);
    setEditorEpoch((n) => n + 1);
    const saved = await persistTemplate(body);
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

  const handleResetConfirm = () => {
    setResetConfirmOpen(false);
    void executeReset();
  };

  return (
    <div className="max-w-6xl mx-auto space-y-2 p-3 md:p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <div className="min-w-0">
          <h1 className="text-base font-bold text-gray-900 flex items-center gap-1.5">
            <FileCode className="h-4 w-4 text-violet-600" />
            Modèle de ticket
          </h1>
          <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">
            Trois modèles intégrés (fichiers nanoTECH / Mikhmon)
          </p>
        </div>
        <VoucherPrintScaleBroadcastButton templateId={presetValue} />
      </div>

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
                    value={loading ? presetValue : findMatchingPresetId(code)}
                    onValueChange={handlePresetChange}
                    disabled={loading || !token}
                  >
                    <SelectTrigger className="h-7 w-full sm:w-[11.5rem] text-xs px-2 py-0 bg-white border-gray-200 shadow-none [&_svg]:h-3 [&_svg]:w-3">
                      <SelectValue placeholder="Choisir…" />
                    </SelectTrigger>
                    <SelectContent className="text-xs">
                      {TICKET_TEMPLATE_PRESETS.map(({ id, label }) => (
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
                      disabled={saving || loading || !token}
                      className="shrink-0"
                    >
                      {saving ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                      Réinitialiser
                    </Button>
                  ) : null}
                </div>
                <div className="flex items-center gap-1 shrink-0 ml-auto">
                  <VoucherPrintScaleButton templateId={presetValue} compact />
                  <Button
                    type="button"
                    size="sm"
                    disabled={saving || loading || !token}
                    onClick={handleSave}
                  >
                    {saving ? <Loader2 className="animate-spin" /> : <Save />}
                    Sauvegarder
                  </Button>
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
                readOnly={!token}
                placeholder="Choisissez un modèle intégré ou collez votre template PHP…"
                editorMinHeight="min(52vh, 500px)"
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
              {TICKET_TEMPLATE_VAR_REFERENCE.map(({ title, code }) => (
                <li
                  key={title}
                  className="rounded-md border border-violet-100/90 bg-violet-50/50 px-2 py-1.5 text-[10px] text-violet-950/90"
                >
                  <p className="font-semibold text-violet-900 mb-0.5">{title} :</p>
                  <pre className="whitespace-pre-wrap break-all font-mono text-[9px] leading-relaxed text-violet-950/85 bg-white/80 rounded px-1 py-0.5 m-0">
                    {code}
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

      <DeleteConfirmDialog
        open={resetConfirmOpen}
        onOpenChange={(o) => { if (!o && !saving) setResetConfirmOpen(false); }}
        icon="warning"
        title="Réinitialiser le modèle ?"
        description="Réappliquer le modèle intégré Mikhmon (small) ? Les modifications non enregistrées seront perdues."
        onConfirm={handleResetConfirm}
        loading={saving}
        confirmLabel="Réinitialiser"
      />
    </div>
  );
}
