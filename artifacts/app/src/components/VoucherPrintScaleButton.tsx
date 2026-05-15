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
};

/**
 * Visible uniquement pour le super admin.
 * Gère l'échelle d'impression par template (localStorage + API).
 * Le bouton "Appliquer à tous" est affiché seulement pour les templates intégrés (pas "custom").
 */
export function VoucherPrintScaleButton({ className, templateId }: VoucherPrintScaleButtonProps) {
  const { token, isSuperAdmin } = useAuth();

  if (!isSuperAdmin) return null;

  const isBuiltIn = templateId !== "custom";
  const authHeaders = { Authorization: `Bearer ${token ?? ""}` };

  const [open, setOpen]               = useState(false);
  const [pct, setPct]                 = useState(() => getVoucherPrintScalePercent(templateId));
  const [synced, setSynced]           = useState(false);
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastOk, setBroadcastOk]   = useState(false);

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
    setBroadcastOk(false);
  }, [templateId]);

  useEffect(() => {
    if (!open) { setBroadcastOk(false); return; }
    fetchFromServer();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleChange = (v: number[]) => {
    const next = v[0] ?? 85;
    setPct(next);
    setVoucherPrintScalePercent(templateId, next);
    setBroadcastOk(false);
    saveToServer(next);
  };

  const handleBroadcast = async () => {
    if (!token || broadcasting) return;
    setBroadcasting(true);
    setBroadcastOk(false);
    try {
      const r = await fetch(`${BASE}/api/admin/print-scale/broadcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ templateId }),
      });
      if (r.ok) setBroadcastOk(true);
    } catch {
      /* ignore */
    } finally {
      setBroadcasting(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className={cn("gap-1.5 shrink-0", className)}>
          <Scaling className="h-3.5 w-3.5" />
          Échelle impression
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(22rem,calc(100vw-2rem))]" align="start">
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs font-medium leading-snug">
              Échelle — {templateId === "custom" ? "Modèle personnalisé" : templateId}
            </Label>
            <p className="text-[11px] text-muted-foreground leading-snug">
              Propre à ce template, synchronisé avec le serveur.{" "}
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

          {isBuiltIn && (
            <>
              <Button
                type="button"
                size="sm"
                className="w-full"
                disabled={broadcasting}
                onClick={handleBroadcast}
              >
                {broadcasting ? "Diffusion…" : "Appliquer à tous les comptes"}
              </Button>

              {broadcastOk && (
                <p className="text-[11px] text-green-600 font-medium text-center">
                  ✓ Échelle diffusée à tous les comptes
                </p>
              )}
            </>
          )}

          {!isBuiltIn && (
            <p className="text-[10px] text-muted-foreground border-t pt-2 leading-snug">
              La diffusion n&apos;est disponible que pour les templates intégrés.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
