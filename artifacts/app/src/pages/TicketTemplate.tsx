import { useEffect, useRef, useState } from "react";
import { FileCode, Save, Loader2, RotateCcw, Upload, BookMarked, Router } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
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

export default function TicketTemplate() {
  const { token } = useAuth();
  const { toast } = useToast();
  const authHeaders = { Authorization: `Bearer ${token ?? ""}` };
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [presetValue, setPresetValue] = useState<TicketTemplatePresetId | "custom">("mikhmon-small");
  const fileRef = useRef<HTMLInputElement>(null);

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
          const id = findMatchingPresetId(fromServer);
          if (id !== "custom") {
            setCode(getPresetBody(id));
            setPresetValue(id);
          } else {
            const stored = getStoredTicketPresetId();
            setPresetValue(stored);
            setCode(getCustomDefault() || getPresetBody(stored));
          }
        } else {
          const stored = getStoredTicketPresetId();
          setPresetValue(stored);
          setCode(getCustomDefault() || getPresetBody(stored));
        }
      })
      .catch(() => {
        const stored = getStoredTicketPresetId();
        setPresetValue(stored);
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
    if (v === "custom") {
      setPresetValue("custom");
      return;
    }
    const id = v as TicketTemplatePresetId;
    setStoredTicketPresetId(id);
    setPresetValue(id);
    const body = getPresetBody(id);
    setCode(body);
    try {
      localStorage.setItem(PHP_KEY, body);
      localStorage.setItem(CUSTOM_DEFAULT_KEY, body);
    } catch { /* ignore */ }
    const label = TICKET_TEMPLATE_PRESETS.find((p) => p.id === id)?.label ?? id;
    toast({ title: "Modèle chargé", description: label });
  };

  const handleReset = () => {
    setCode(getCustomDefault() ?? DEFAULT_MIKHMON_PHP);
    const id = getStoredTicketPresetId();
    setPresetValue(findMatchingPresetId(getCustomDefault() ?? getPresetBody(id)));
    toast({ title: "Réinitialisé", description: "Modèle de base local ou préréglage Mikhmon (small)." });
  };

  const handleUseDefaultMikhmon = () => {
    setStoredTicketPresetId("mikhmon-small");
    setPresetValue("mikhmon-small");
    const body = DEFAULT_MIKHMON_PHP;
    setCode(body);
    try {
      localStorage.setItem(PHP_KEY, body);
      localStorage.setItem(CUSTOM_DEFAULT_KEY, body);
    } catch { /* ignore */ }
    toast({ title: "Mikhmon (small)", description: "Enregistrez pour appliquer sur le serveur." });
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const raw = ev.target?.result as string;
      setCode(raw);
      setPresetValue(findMatchingPresetId(raw));
      try {
        localStorage.setItem(PHP_KEY, raw);
        localStorage.setItem(CUSTOM_DEFAULT_KEY, raw);
      } catch { /* ignore */ }
      toast({ title: "Fichier importé", description: `${file.name} — validez avec Sauvegarder pour le serveur.` });
    };
    reader.readAsText(file, "UTF-8");
    e.target.value = "";
  };

  const handleSetAsDefault = () => {
    if (!code.trim()) return;
    try {
      localStorage.setItem(CUSTOM_DEFAULT_KEY, code);
      localStorage.setItem(PHP_KEY, code);
    } catch { /* ignore */ }
    toast({ title: "Modèle de base local", description: "Utilisé pour Réinitialiser sur cet appareil." });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <FileCode className="h-5 w-5 text-violet-600" />
          Modèle de ticket
        </h1>
        <p className="text-xs text-gray-500 mt-0.5">
          Trois modèles intégrés (fichiers nanoTECH / Mikhmon) — stockage serveur pour ce tenant.
        </p>
      </div>

      <Card>
        <CardHeader className="py-3 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-end gap-3 sm:gap-4">
            <div className="flex-1 min-w-0 space-y-1.5">
              <Label className="text-xs font-medium text-gray-700 flex items-center gap-1.5">
                <Router className="h-3.5 w-3.5 text-gray-500" />
                Modèle intégré
              </Label>
              <Select
                value={presetValue}
                onValueChange={handlePresetChange}
                disabled={loading || !token}
              >
                <SelectTrigger className="h-9 text-sm w-full sm:max-w-md bg-white border-gray-200">
                  <SelectValue placeholder="Choisir un modèle…" />
                </SelectTrigger>
                <SelectContent>
                  {TICKET_TEMPLATE_PRESETS.map(({ id, label }) => (
                    <SelectItem key={id} value={id} className="text-sm">
                      {label}
                    </SelectItem>
                  ))}
                  <SelectItem value="custom" className="text-sm text-muted-foreground">
                    Personnalisé (contenu hors modèles)
                  </SelectItem>
                </SelectContent>
              </Select>
              {presetValue === "custom" && (
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-2 py-1">
                  Le texte ne correspond exactement à aucun des trois modèles — choisissez un modèle ci-dessus pour le remplacer, ou continuez à éditer à la main.
                </p>
              )}
            </div>
          </div>
          <CardTitle className="text-sm pt-1">Éditeur</CardTitle>
          <CardDescription className="text-xs">
            Par défaut : <strong>Mikhmon (small)</strong> lorsque le serveur n’a pas encore de modèle. Sauvegardez pour synchroniser.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Button type="button" variant="outline" size="sm" onClick={handleReset} className="gap-1.5 text-orange-600 border-orange-200">
              <RotateCcw className="h-3.5 w-3.5" />
              Réinitialiser
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={handleUseDefaultMikhmon} className="gap-1.5">
              <FileCode className="h-3.5 w-3.5" />
              Mikhmon (small)
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} className="gap-1.5">
              <Upload className="h-3.5 w-3.5" />
              Importer .php
            </Button>
            <input ref={fileRef} type="file" accept=".php,.html,.txt" className="hidden" onChange={handleImport} />
            <Button type="button" variant="outline" size="sm" onClick={handleSetAsDefault} className="gap-1.5 text-blue-700 border-blue-200">
              <BookMarked className="h-3.5 w-3.5" />
              Définir par défaut (local)
            </Button>
            <Button type="button" size="sm" className="gap-1.5 ml-auto bg-violet-600 hover:bg-violet-700" disabled={saving || loading || !token} onClick={handleSave}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Sauvegarder
            </Button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Chargement…
            </div>
          ) : (
            <textarea
              className="w-full min-h-[320px] rounded-md border bg-background px-3 py-2 text-xs font-mono resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={code}
              onChange={(e) => {
                const next = e.target.value;
                setCode(next);
                setPresetValue(findMatchingPresetId(next));
              }}
              placeholder="Choisissez un modèle intégré ou collez votre fichier…"
              spellCheck={false}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
