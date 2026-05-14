import { useEffect, useState } from "react";
import { FileCode, Save, Loader2, RotateCcw, Router } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { TicketTemplateCodeEditor } from "@/components/TicketTemplateCodeEditor";
import { TicketTemplateVarLegend } from "@/components/TicketTemplateVarLegend";
import { TicketTemplatePreview } from "@/components/TicketTemplatePreview";
import { VoucherPrintScaleControl } from "@/components/VoucherPrintScaleControl";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  DEFAULT_MIKHMON_PHP,
  PHP_KEY,
  CUSTOM_DEFAULT_KEY,
  getCustomDefault,
} from "@/lib/voucher-ticket-defaults";
import {
  TICKET_TEMPLATE_PRESETS,
  type TicketTemplatePresetId,
  getPresetBody,
  getStoredTicketPresetId,
  setStoredTicketPresetId,
  findMatchingPresetId,
} from "@/lib/voucher-ticket-presets";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const CUSTOM_OPTION_VALUE = "custom" as const;

export default function TicketTemplate() {
  const { token } = useAuth();
  const { toast } = useToast();
  const authHeaders = { Authorization: `Bearer ${token ?? ""}` };
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const presetMatch = findMatchingPresetId(code);
  const showCustomSelectOption = presetMatch === CUSTOM_OPTION_VALUE;

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(`${BASE}/api/admin/ticket-template`, { headers: authHeaders })
      .then((r) => (r.ok ? r.json() : { template: null }))
      .then((data: { template: string | null }) => {
        const fromServer = data.template?.trim() ?? "";
        if (fromServer) {
          setCode(fromServer);
        } else {
          const stored = getStoredTicketPresetId();
          setCode(getCustomDefault() || getPresetBody(stored));
        }
      })
      .catch(() => {
        const stored = getStoredTicketPresetId();
        setCode(getCustomDefault() || getPresetBody(stored));
      })
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleSave = async () => {
    if (!token) return;
    setSaving(true);
    try {
      const r = await fetch(`${BASE}/api/admin/ticket-template`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ template: code }),
      });
      if (r.ok) {
        toast({ title: "Modèle enregistré", description: "Synchronisé sur le serveur pour ce compte administrateur." });
      } else {
        const err = await r.json().catch(() => ({})) as { error?: string };
        toast({ title: "Erreur", description: err.error ?? "Sauvegarde impossible.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handlePresetChange = (v: string) => {
    if (v === CUSTOM_OPTION_VALUE) return;
    const id = v as TicketTemplatePresetId;
    setStoredTicketPresetId(id);
    const body = getPresetBody(id);
    setCode(body);
    try {
      localStorage.setItem(PHP_KEY, body);
      localStorage.setItem(CUSTOM_DEFAULT_KEY, body);
    } catch { /* ignore */ }
    const label = TICKET_TEMPLATE_PRESETS.find((p) => p.id === id)?.label ?? id;
    toast({ title: "Modèle chargé", description: label });
  };

  /** Réapplique le modèle Mikhmon (small) pour l’éditeur et les impressions de vouchers (après Sauvegarde serveur). */
  const handleResetToMikhmonSmall = () => {
    setStoredTicketPresetId("mikhmon-small");
    const body = DEFAULT_MIKHMON_PHP;
    setCode(body);
    try {
      localStorage.setItem(PHP_KEY, body);
      localStorage.setItem(CUSTOM_DEFAULT_KEY, body);
    } catch { /* ignore */ }
    toast({
      title: "Modèle réinitialisé",
      description: "Modèle de ticket style Mikhmon (small). Enregistrez pour synchroniser sur le serveur.",
    });
  };

  return (
    <div className="max-w-6xl mx-auto space-y-2 md:space-y-3 p-3 md:p-4">
      <div>
        <h1 className="text-base md:text-lg font-bold text-gray-900 flex items-center gap-2">
          <FileCode className="h-5 w-5 shrink-0 text-violet-600" />
          Modèle de ticket
        </h1>
        <p className="text-xs text-gray-500 mt-0 leading-snug">
          Trois modèles intégrés (fichiers nanoTECH / Mikhmon)
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(200px,240px)] lg:items-stretch">
        <Card className="flex min-h-0 h-full min-w-0 flex-col">
          <CardHeader className="shrink-0 p-3 sm:p-4 py-2 space-y-2">
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center lg:gap-2">
                <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2 lg:max-w-[min(100%,14rem)] xl:max-w-[16rem]">
                  <Label className="flex shrink-0 items-center gap-1.5 text-xs font-medium whitespace-nowrap text-gray-700">
                    <Router className="h-3.5 w-3.5 shrink-0 text-gray-500" />
                    Modèle intégré
                  </Label>
                  <Select
                    value={presetMatch}
                    onValueChange={handlePresetChange}
                    disabled={loading || !token}
                  >
                    <SelectTrigger className="h-9 min-h-9 w-full min-w-0 flex-1 border-gray-200 bg-white text-sm sm:max-w-md lg:h-8 lg:min-h-8 lg:max-w-full lg:text-xs lg:leading-snug [&>span]:block [&>span]:min-w-0 [&>span]:truncate [&>span]:text-left">
                      <SelectValue placeholder="Choisir un modèle…" />
                    </SelectTrigger>
                    <SelectContent>
                      {TICKET_TEMPLATE_PRESETS.map(({ id, label }) => (
                        <SelectItem key={id} value={id} className="text-sm">
                          {label}
                        </SelectItem>
                      ))}
                      {showCustomSelectOption && (
                        <SelectItem value={CUSTOM_OPTION_VALUE} className="text-sm text-muted-foreground">
                          Modèle de ticket personnalisé
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <VoucherPrintScaleControl />
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 max-lg:w-full max-lg:justify-between">
                  {showCustomSelectOption && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleResetToMikhmonSmall}
                      className="h-8 gap-1.5 text-xs text-orange-600 border-orange-200 lg:shrink-0"
                    >
                      <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                      Réinitialiser
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 gap-1.5 bg-violet-600 text-xs hover:bg-violet-700 max-lg:ml-auto lg:shrink-0"
                    disabled={saving || loading || !token}
                    onClick={handleSave}
                  >
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5 shrink-0" />}
                    Sauvegarder
                  </Button>
                </div>
              </div>
              {showCustomSelectOption && (
                <p className="text-[11px] leading-snug text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-2 py-0.5">
                  Le code a été modifié par rapport aux trois modèles intégrés — choisissez un modèle ci-dessus pour
                  revenir à un fichier fourni, ou gardez votre version personnalisée.
                </p>
              )}
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col space-y-2 p-3 sm:p-4 pt-0">
            <CardTitle className="shrink-0 text-sm">Éditeur PHP</CardTitle>

            {loading ? (
              <div className="flex min-h-[12rem] flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Chargement…
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <TicketTemplateCodeEditor
                  value={code}
                  onChange={(next) => setCode(next)}
                  height="100%"
                  placeholder="Choisissez un modèle intégré ou éditez le code…"
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="flex min-h-[22rem] shrink-0 flex-col self-stretch lg:sticky lg:top-4">
          <CardHeader className="shrink-0 p-3 sm:p-4 py-2 pb-1">
            <CardTitle className="text-sm font-semibold">Variables</CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-4 pt-0">
            <TicketTemplateVarLegend variant="plain" />
          </CardContent>
        </Card>
      </div>

      {!loading && <TicketTemplatePreview code={code} />}
    </div>
  );
}
