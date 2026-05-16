import { useEffect, useState } from "react";
import { Scaling, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import {
  getVoucherPrintScalePercent,
  setVoucherPrintScalePercent,
} from "@/lib/voucher-print-scale";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type VoucherPrintScaleBroadcastButtonProps = {
  templateId: string;
  className?: string;
};

/**
 * Diffuse l’échelle du template sélectionné à tous les comptes (super admin).
 * Même enveloppe visuelle que {@link VoucherPrintScaleButton} (popover + libellés).
 */
export function VoucherPrintScaleBroadcastButton({
  templateId,
  className,
}: VoucherPrintScaleBroadcastButtonProps) {
  const { token, isSuperAdmin } = useAuth();
  const { toast } = useToast();
  const authHeaders = { Authorization: `Bearer ${token ?? ""}` };

  const [open, setOpen] = useState(false);
  const [broadcasting, setBroadcasting] = useState(false);
  const [synced, setSynced] = useState(false);
  const [broadcastPct, setBroadcastPct] = useState(() =>
    getVoucherPrintScalePercent(templateId),
  );

  if (!isSuperAdmin) return null;

  const isBuiltIn = templateId !== "custom";
  const templateLabel =
    templateId === "custom" ? "Modèle personnalisé" : templateId;

  useEffect(() => {
    setBroadcastPct(getVoucherPrintScalePercent(templateId));
    setSynced(false);
  }, [templateId]);

  useEffect(() => {
    if (!open || !token || !isBuiltIn) return;
    let cancelled = false;
    setSynced(false);
    void (async () => {
      try {
        const r = await fetch(`${BASE}/api/admin/print-scale`, { headers: authHeaders });
        if (!r.ok || cancelled) return;
        const data = (await r.json()) as { scales?: Record<string, number> };
        const v = data.scales?.[templateId];
        if (v !== null && v !== undefined && Number.isFinite(v)) {
          setBroadcastPct(Math.min(100, Math.max(0, Math.round(v))));
        } else {
          setBroadcastPct(getVoucherPrintScalePercent(templateId));
        }
        if (!cancelled) setSynced(true);
      } catch {
        if (!cancelled) {
          setBroadcastPct(getVoucherPrintScalePercent(templateId));
          setSynced(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, token, templateId, isBuiltIn]);

  const handleSliderChange = (v: number[]) => {
    const next = v[0] ?? 85;
    setBroadcastPct(Math.min(100, Math.max(0, Math.round(next))));
  };

  const handleBroadcast = async () => {
    if (!token || broadcasting || !isBuiltIn) return;
    setBroadcasting(true);
    try {
      const r = await fetch(`${BASE}/api/admin/print-scale/broadcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ templateId, scale: broadcastPct }),
      });
      if (r.ok) {
        setVoucherPrintScalePercent(templateId, broadcastPct);
        toast({
          title: "Échelle diffusée",
          description: `${broadcastPct}% appliqué à tous les comptes pour « ${templateLabel} ».`,
        });
        setOpen(false);
      } else {
        const err = (await r.json().catch(() => ({}))) as { error?: string };
        toast({
          title: "Diffusion impossible",
          description: err.error ?? "Erreur serveur.",
          variant: "destructive",
        });
      }
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
    } finally {
      setBroadcasting(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="accentOutline"
          size="sm"
          className={cn("shrink-0", className)}
          disabled={!isBuiltIn}
          title={
            isBuiltIn
              ? "Diffuser l’échelle actuelle à tous les comptes"
              : "Disponible uniquement pour les modèles intégrés"
          }
        >
          <Scaling />
          Appliquer à tous
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(22rem,calc(100vw-2rem))]" align="start">
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs font-medium leading-snug">
              Échelle — {templateLabel}
            </Label>
            <p className="text-[11px] text-muted-foreground leading-snug">
              Diffusion globale (tous les comptes administrateurs), synchronisé avec le serveur.{" "}
              {synced && <span className="text-green-600 font-medium">✓ synchronisé</span>}
            </p>
          </div>

          <div className="space-y-2.5 rounded-md border bg-muted/20 p-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium leading-tight">Échelle web</span>
              <span className="text-xl font-semibold tabular-nums tracking-tight">
                {broadcastPct}%
              </span>
            </div>
            <Slider
              min={0}
              max={100}
              step={1}
              value={[broadcastPct]}
              onValueChange={handleSliderChange}
              disabled={broadcasting || !isBuiltIn}
            />
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              disabled={broadcasting}
              onClick={() => setOpen(false)}
            >
              Annuler
            </Button>
            <Button
              type="button"
              variant="accentOutline"
              size="sm"
              className="h-8 gap-1.5"
              disabled={broadcasting || !isBuiltIn}
              onClick={() => void handleBroadcast()}
            >
              {broadcasting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                  Diffusion…
                </>
              ) : (
                "Appliquer à tous"
              )}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
