import { useCallback, useEffect, useRef, useState } from "react";
import { FileCode, Loader2, RotateCcw, Router, Braces, Save, SlidersHorizontal } from "lucide-react";
import { TicketPhpEditor } from "@/components/TicketPhpEditor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  PHP_KEY,
  CUSTOM_DEFAULT_KEY,
  getCustomDefault,
  TICKET_TEMPLATE_EDITOR_LIVE_KEY,
} from "@/lib/voucher-ticket-defaults";
import {
  TICKET_TEMPLATE_PRESETS,
  type TicketTemplatePresetId,
  getPresetBody,
  getStoredTicketPresetId,
  setStoredTicketPresetId,
  findMatchingPresetId,
} from "@/lib/voucher-ticket-presets";
import {
  TICKET_TEMPLATE_VAR_REFERENCE,
  TICKET_TEMPLATE_VAR_REFERENCE_CONDITIONAL,
} from "@/lib/ticket-template-vars";
import {
  clampVoucherPrintScale,
  getVoucherPrintScaleDesktop,
  getVoucherPrintScaleMobile,
  setVoucherPrintScaleDesktop,
  setVoucherPrintScaleMobile,
  VOUCHER_PRINT_SCALE_DEFAULT,
} from "@/lib/voucher-print-scale";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function TicketPrintScaleBar({
  id,
  label,
  value,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  onCommit: (n: number) => void;
}) {
  /** Zone « barre + libellé » : la molette doit modifier l’échelle sans faire défiler la page. */
  const wheelZoneRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  useEffect(() => {
    const el = wheelZoneRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.deltaY === 0) return;
      const step = e.deltaY < 0 ? 1 : -1;
      onCommitRef.current(clampVoucherPrintScale(valueRef.current + step));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div ref={wheelZoneRef} className="space-y-0.5 flex-1 min-w-[140px]">
      <Label htmlFor={id} className="text-[10px] text-muted-foreground leading-none block">
        {label}
        {" "}
        <span className="font-mono text-foreground">({value} %)</span>
      </Label>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(e) => onCommit(Number(e.target.value))}
        className="w-full h-2 accent-violet-600 cursor-ew-resize"
      />
    </div>
  );
}

export default function TicketTemplate() {
  const { token } = useAuth();
  const { toast } = useToast();
  const authHeaders = { Authorization: `Bearer ${token ?? ""}` };
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [scaleDesktop, setScaleDesktopState] = useState(VOUCHER_PRINT_SCALE_DEFAULT);
  const [scaleMobile, setScaleMobileState] = useState(VOUCHER_PRINT_SCALE_DEFAULT);
  const presetSyncAbortRef = useRef<AbortController | null>(null);
  /** Limite les toasts « modèle personnalisé enregistré » pendant l’édition continue. */
  const lastCustomSavedToastAtRef = useRef(0);

  /** Toujours dérivé du texte de l’éditeur (source de vérité pour l’opérateur). */
  const editorTemplateKind = findMatchingPresetId(code);

  const syncTemplateBodyToServer = useCallback((body: string): Promise<"ok" | "fail" | "aborted"> => {
    if (!token) return Promise.resolve("fail");
    presetSyncAbortRef.current?.abort();
    const ac = new AbortController();
    presetSyncAbortRef.current = ac;
    return fetch(`${BASE}/api/admin/ticket-template`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ template: body }),
      signal: ac.signal,
    })
      .then((r) => {
        if (ac.signal.aborted) return "aborted";
        return r.ok ? "ok" : "fail";
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return "aborted";
        return "fail";
      });
  }, [token]);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(`${BASE}/api/admin/ticket-template`, { headers: authHeaders, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { template: null }))
      .then((data: { template: string | null }) => {
        const fromServer = data.template?.trim() ?? "";
        if (fromServer) {
          const id = findMatchingPresetId(fromServer);
          if (id !== "custom") {
            setCode(getPresetBody(id));
          } else {
            setCode(fromServer);
          }
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

  useEffect(() => {
    setScaleDesktopState(getVoucherPrintScaleDesktop());
    setScaleMobileState(getVoucherPrintScaleMobile());
  }, []);

  useEffect(() => {
    if (!code.trim()) return;
    try {
      localStorage.setItem(TICKET_TEMPLATE_EDITOR_LIVE_KEY, code);
    } catch {
      /* ignore */
    }
  }, [code]);

  const commitScaleDesktop = (n: number) => {
    const v = clampVoucherPrintScale(n);
    setVoucherPrintScaleDesktop(v);
    setScaleDesktopState(v);
  };

  const commitScaleMobile = (n: number) => {
    const v = clampVoucherPrintScale(n);
    setVoucherPrintScaleMobile(v);
    setScaleMobileState(v);
  };

  /** Texte personnalisé (hors des 3 fichiers embarqués) : afficher Réinitialiser. */
  const showResetButton = findMatchingPresetId(code) === "custom";

  useEffect(() => {
    if (!token || loading) return;
    const t = window.setTimeout(() => {
      const kindAtSave = findMatchingPresetId(code);
      void syncTemplateBodyToServer(code).then((result) => {
        if (result === "ok") {
          try {
            localStorage.setItem(PHP_KEY, code);
            localStorage.setItem(CUSTOM_DEFAULT_KEY, code);
          } catch { /* ignore */ }
          if (kindAtSave === "custom") {
            const now = Date.now();
            if (now - lastCustomSavedToastAtRef.current > 14_000) {
              lastCustomSavedToastAtRef.current = now;
              toast({
                title: "Modèle personnalisé enregistré",
                description: "Le serveur et les prochaines impressions utilisent ce texte. Le sélecteur affiche « Personnalisé ».",
              });
            }
          }
        } else if (result === "fail") {
          toast({
            title: "Sauvegarde automatique impossible",
            description: "Vérifiez la connexion puis modifiez à nouveau le modèle.",
            variant: "destructive",
          });
        }
      });
    }, 800);
    return () => window.clearTimeout(t);
  }, [code, token, loading, syncTemplateBodyToServer, toast]);

  const handlePresetChange = (v: string) => {
    if (v === "custom") {
      return;
    }
    const id = v as TicketTemplatePresetId;
    setStoredTicketPresetId(id);
    const body = getPresetBody(id);
    setCode(body);
    try {
      localStorage.setItem(PHP_KEY, body);
      localStorage.setItem(CUSTOM_DEFAULT_KEY, body);
    } catch { /* ignore */ }
    const label = TICKET_TEMPLATE_PRESETS.find((p) => p.id === id)?.label ?? id;
    if (!token) {
      toast({
        title: "Modèle chargé",
        description: `${label} — connectez-vous pour synchroniser l’impression sur le serveur.`,
      });
      return;
    }
    void syncTemplateBodyToServer(body).then((result) => {
      if (result === "aborted") return;
      if (result === "ok") {
        toast({
          title: "Modèle actif",
          description: `${label} — enregistré sur le serveur pour l’impression.`,
        });
      } else {
        toast({
          title: "Synchronisation impossible",
          description: `${label} est chargé localement. Réessayez ou choisissez un autre modèle.`,
          variant: "destructive",
        });
      }
    });
  };

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
        try {
          localStorage.setItem(PHP_KEY, code);
          localStorage.setItem(CUSTOM_DEFAULT_KEY, code);
        } catch { /* ignore */ }
        toast({ title: "Modèle enregistré", description: "Synchronisé sur le serveur pour ce tenant." });
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

  const handleReset = () => {
    const body = getPresetBody("mikhmon-small");
    setStoredTicketPresetId("mikhmon-small");
    setCode(body);
    try {
      localStorage.setItem(PHP_KEY, body);
      localStorage.setItem(CUSTOM_DEFAULT_KEY, body);
    } catch { /* ignore */ }
    if (!token) {
      toast({
        title: "Modèle réinitialisé",
        description: "Mikhmon (small) est appliqué localement. Connectez-vous pour l’enregistrer sur le serveur.",
      });
      return;
    }
    setResetting(true);
    void syncTemplateBodyToServer(body)
      .then((result) => {
        if (result === "aborted") return;
        if (result === "ok") {
          toast({
            title: "Modèle réinitialisé",
            description: "Mikhmon (small) est actif pour les prochaines impressions.",
          });
        } else {
          toast({
            title: "Erreur serveur",
            description: "Le modèle local est Mikhmon (small) ; la synchronisation a échoué.",
            variant: "destructive",
          });
        }
      })
      .finally(() => setResetting(false));
  };

  return (
    <div className="max-w-6xl mx-auto space-y-2 p-3 md:p-4">
      <div>
        <h1 className="text-base font-bold text-gray-900 flex items-center gap-2">
          <FileCode className="h-4 w-4 text-violet-600 shrink-0" />
          Modèle de ticket
        </h1>
        <p className="text-[11px] text-gray-500 mt-0 leading-tight">
          Trois modèles intégrés (fichiers nanoTECH / Mikhmon)
        </p>
      </div>

      <div className="min-h-0 lg:h-[calc(100dvh_-_8.5rem_+_50px)]">
        <div className="grid h-full min-h-0 grid-cols-1 gap-2 items-start lg:grid-cols-[1fr_minmax(200px,240px)] lg:gap-3 lg:items-stretch">
        <Card className="flex min-h-0 w-full min-w-0 flex-col overflow-hidden shadow-sm lg:h-full">
          <CardHeader className="shrink-0 space-y-2 p-3 sm:p-4 sm:pb-3">
            <div className="flex flex-col gap-2 w-full max-w-4xl">
              <Label className="text-xs font-medium text-gray-700 flex items-center gap-1.5">
                <Router className="h-3.5 w-3.5 text-gray-500" />
                Modèle intégré
              </Label>
              <div className="flex min-w-0 flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1 basis-0 overflow-hidden">
                  <Select
                    value={editorTemplateKind}
                    onValueChange={handlePresetChange}
                    disabled={loading || !token}
                  >
                    <SelectTrigger
                      className={`h-9 text-sm w-full bg-white border-gray-200 ${
                        editorTemplateKind === "custom"
                          ? "border-amber-300 bg-amber-50/60 text-amber-950"
                          : ""
                      }`}
                    >
                      <SelectValue placeholder="Choisir un modèle…" />
                    </SelectTrigger>
                    <SelectContent>
                      {TICKET_TEMPLATE_PRESETS.map(({ id, label }) => (
                        <SelectItem key={id} value={id} className="text-sm">
                          {label}
                        </SelectItem>
                      ))}
                      <SelectItem
                        value="custom"
                        disabled={editorTemplateKind !== "custom"}
                        className="text-sm text-amber-900 focus:bg-amber-50"
                      >
                        Modèle personnalisé (texte différent des trois gabarits)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex shrink-0 flex-wrap items-end justify-end gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9 shrink-0 gap-0 px-2.5 sm:gap-1.5 sm:px-3 border-violet-200 text-violet-900 hover:bg-violet-50"
                        disabled={loading}
                        aria-label="Échelle d’impression"
                      >
                        <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        <span className="hidden sm:inline">Échelle d’impression</span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[min(100vw-2rem,22rem)] p-3" align="start">
                      <div className="space-y-3">
                        <div>
                          <p className="text-xs font-semibold text-foreground">Échelle d’impression</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">
                            De 0 % à 100 % (100 % = taille normale). Réglages distincts pour le bureau et le mobile / APK. Stockage local, appliqué aux prochaines impressions. Molette au-dessus du libellé ou du curseur : ±1 % (sans faire défiler la page).
                          </p>
                        </div>
                        <TicketPrintScaleBar
                          id="ticket-print-scale-desktop"
                          label="Navigateur desktop"
                          value={scaleDesktop}
                          onCommit={commitScaleDesktop}
                        />
                        <TicketPrintScaleBar
                          id="ticket-print-scale-mobile"
                          label="Mobile / APK (WebView)"
                          value={scaleMobile}
                          onCommit={commitScaleMobile}
                        />
                      </div>
                    </PopoverContent>
                  </Popover>
                  <Button
                    type="button"
                    size="sm"
                    className="h-9 shrink-0 gap-1.5 bg-violet-600 hover:bg-violet-700"
                    disabled={saving || loading || !token}
                    onClick={() => void handleSave()}
                  >
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    Sauvegarder
                  </Button>
                </div>
              </div>
            </div>
            <CardTitle className="text-xs font-semibold pt-0.5">Éditeur</CardTitle>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col space-y-2 overflow-y-auto px-3 pt-0 pb-2 sm:px-4 sm:pt-0 sm:pb-3">
            {showResetButton && !loading && (
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleReset}
                  disabled={resetting}
                  className="gap-1.5 text-orange-600 border-orange-200"
                >
                  {resetting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                  Réinitialiser
                </Button>
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Chargement…
              </div>
            ) : (
              <TicketPhpEditor
                value={code}
                onChange={setCode}
                editorMinHeight="min(calc(44vh + 90px), 92dvh)"
                placeholder="Choisissez un modèle intégré ou collez votre fichier…"
              />
            )}
          </CardContent>
        </Card>

        <Card className="flex min-h-0 min-w-0 flex-col overflow-hidden border-violet-100 shadow-sm lg:sticky lg:top-2 lg:h-full">
          <CardHeader className="shrink-0 space-y-1 p-3 sm:p-4 sm:pb-2">
            <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
              <Braces className="h-3.5 w-3.5 text-violet-600 shrink-0" />
              Variables du modèle
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-[min(52vh,380px)] overflow-y-auto p-3 pt-0 sm:p-4 sm:pt-0 lg:max-h-none lg:min-h-0 lg:flex-1">
            {loading ? (
              <p className="text-[11px] text-muted-foreground flex items-center gap-2 py-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Chargement…
              </p>
            ) : (
              <div className="space-y-2 text-[11px]">
                {TICKET_TEMPLATE_VAR_REFERENCE.map((entry) => (
                  <div key={entry.title} className="border-b border-border/60 pb-2 last:border-0 last:pb-0">
                    <div className="text-[10px] font-semibold text-foreground leading-tight">
                      {entry.title}
                      {" "}
                      <span className="text-muted-foreground font-normal">:</span>
                    </div>
                    <pre className="mt-0.5 text-[9px] leading-snug font-mono text-violet-900 dark:text-violet-200 bg-muted/60 rounded px-1.5 py-1 overflow-x-auto whitespace-pre-wrap break-all">
                      {entry.code}
                    </pre>
                  </div>
                ))}
                <div className="border-b border-border/60 pb-2 last:border-0">
                  <div className="text-[10px] font-semibold text-foreground leading-tight">
                    {TICKET_TEMPLATE_VAR_REFERENCE_CONDITIONAL.title}
                    <span className="text-muted-foreground font-normal"> :</span>
                  </div>
                  <pre className="mt-0.5 text-[9px] leading-snug font-mono text-foreground/90 bg-muted/40 rounded px-1.5 py-1 overflow-x-auto whitespace-pre-wrap">
                    {TICKET_TEMPLATE_VAR_REFERENCE_CONDITIONAL.body}
                  </pre>
                  <p className="mt-1 text-[9px] text-muted-foreground leading-tight">
                    Gabarit PHP attendu par le moteur d’impression :
                  </p>
                  <pre className="mt-0.5 text-[8px] leading-snug font-mono text-violet-900 dark:text-violet-200 bg-muted/60 rounded px-1.5 py-1 overflow-x-auto whitespace-pre-wrap break-all">
                    {TICKET_TEMPLATE_VAR_REFERENCE_CONDITIONAL.templateHint}
                  </pre>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        </div>
      </div>
    </div>
  );
}
