import { useEffect, useRef, useState } from "react";
import { Scaling } from "lucide-react";
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

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type VoucherPrintScaleButtonProps = {
  className?: string;
  templateId: string;
  /** Bouton compact (barre d’outils modèle de ticket). */
  compact?: boolean;
};

/**
 * Visible uniquement pour le super admin.
 * Gère l'échelle d'impression par template (localStorage + API).
 * Réglage personnel super admin (localStorage + API). La diffusion globale est dans VoucherPrintScaleBroadcastButton.
 */
export function VoucherPrintScaleButton({ className, templateId, compact }: VoucherPrintScaleButtonProps) {
  const { token, isSuperAdmin } = useAuth();

  if (!isSuperAdmin) return null;

  const authHeaders = { Authorization: `Bearer ${token ?? ""}` };

  const [open, setOpen] = useState(false);
  const [pct, setPct] = useState(() => getVoucherPrintScalePercent(templateId));
  const [synced, setSynced] = useState(false);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchFromServer = async () => {
    if (!token) return;
    try {
      const r = await fetch(`${BASE}/api/admin/print-scale`, { headers: authHeaders });
      if (!r.ok) return;
      const data = (await r.json()) as { scales: Record<string, number> };
      const val = data.scales?.[templateId];
      if (val !== null && val !== undefined) {
        setVoucherPrintScalePercent(templateId, val);
        setPct(val);
      }
      setSynced(true);
    } catch {
      /* offline — localStorage conservé */
    }
  };

  const saveToServer = (val: number) => {
    if (!token) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      fetch(`${BASE}/api/admin/print-scale`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ templateId, scale: val }),
      }).catch(() => { /* ignore réseau */ });
    }, 600);
  };

  useEffect(() => {
    fetchFromServer();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, templateId]);

  useEffect(() => {
    setPct(getVoucherPrintScalePercent(templateId));
    setSynced(false);
  }, [templateId]);

  useEffect(() => {
    if (!open) return;
    fetchFromServer();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleChange = (v: number[]) => {
    const next = v[0] ?? 85;
    setPct(next);
    setVoucherPrintScalePercent(templateId, next);
    saveToServer(next);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="accentOutline"
          size="sm"
          className={cn("shrink-0", !compact && "px-2.5", className)}
        >
          <Scaling />
          {compact ? "Échelle" : "Échelle impression"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(22rem,calc(100vw-2rem))]" align="start">
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs font-medium leading-snug">
              Échelle — {templateId === "custom" ? "Modèle personnalisé" : templateId}
            </Label>
            <p className="text-[11px] text-muted-foreground leading-snug">
              Réglage personnel (votre compte super admin), synchronisé avec le serveur.{" "}
              {synced && <span className="text-green-600 font-medium">✓ synchronisé</span>}
            </p>
          </div>

          <div className="space-y-2.5 rounded-md border bg-muted/20 p-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium leading-tight">Échelle web</span>
              <span className="text-xl font-semibold tabular-nums tracking-tight">{pct}%</span>
            </div>
            <Slider
              min={0}
              max={100}
              step={1}
              value={[pct]}
              onValueChange={handleChange}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
