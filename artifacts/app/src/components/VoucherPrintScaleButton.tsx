import { useEffect, useRef, useState } from "react";
import { Scaling, Users } from "lucide-react";
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
};

/**
 * Bouton d'échelle d'impression — visible uniquement pour le super admin.
 * Permet de régler l'échelle et de la diffuser à tous les comptes via "Appliquer à tous".
 */
export function VoucherPrintScaleButton({ className }: VoucherPrintScaleButtonProps) {
  const { token, isSuperAdmin } = useAuth();

  // Masqué pour tous les non-super-admins
  if (!isSuperAdmin) return null;

  return <VoucherPrintScaleButtonInner token={token} className={className} />;
}

function VoucherPrintScaleButtonInner({ token, className }: { token: string | null; className?: string }) {
  const authHeaders = { Authorization: `Bearer ${token ?? ""}` };

  const [open, setOpen]       = useState(false);
  const [pct, setPct]         = useState(() => getVoucherPrintScalePercent());
  const [synced, setSynced]   = useState(false);
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastOk, setBroadcastOk]   = useState(false);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchFromServer = async () => {
    if (!token) return;
    try {
      const r = await fetch(`${BASE}/api/admin/print-scale`, { headers: authHeaders });
      if (!r.ok) return;
      const data = (await r.json()) as { scaleWeb: number | null };
      if (data.scaleWeb !== null && data.scaleWeb !== undefined) {
        setVoucherPrintScalePercent(data.scaleWeb);
        setPct(data.scaleWeb);
      }
      setSynced(true);
    } catch { /* offline — localStorage conservé */ }
  };

  const saveToServer = (web: number) => {
    if (!token) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      fetch(`${BASE}/api/admin/print-scale`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ scaleWeb: web }),
      }).catch(() => { /* ignore réseau */ });
    }, 600);
  };

  useEffect(() => { fetchFromServer(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) { setBroadcastOk(false); return; }
    fetchFromServer();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (v: number[]) => {
    const next = v[0] ?? 100;
    setPct(next);
    setVoucherPrintScalePercent(next);
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
      });
      if (r.ok) setBroadcastOk(true);
    } catch { /* ignore */ }
    finally { setBroadcasting(false); }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className={cn("gap-1.5 shrink-0", className)}>
          <Scaling className="h-3.5 w-3.5" />
          Scale Impression
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(22rem,calc(100vw-2rem))]" align="start">
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs font-medium leading-snug">
              Mise à l&apos;échelle impression
            </Label>
            <p className="text-[11px] text-muted-foreground leading-snug">
              Réglage synchronisé entre appareils.{" "}
              {synced && <span className="text-green-600 font-medium">✓ synchronisé</span>}
            </p>
          </div>

          <div className="space-y-2.5 rounded-md border bg-muted/20 p-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium leading-tight">Échelle d&apos;impression</span>
              <span className="text-xl font-semibold tabular-nums tracking-tight">{pct}%</span>
            </div>
            <Slider min={0} max={100} step={1} value={[pct]} onValueChange={handleChange} />
          </div>

          <div className="border-t pt-2.5 space-y-2">
            <p className="text-[11px] text-muted-foreground leading-snug">
              Appliquer cette échelle ({pct}%) à <strong className="text-foreground">tous les comptes</strong>{" "}
              (admins, gérants, collaborateurs).
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={cn(
                "w-full gap-1.5",
                broadcastOk && "border-green-500 text-green-700"
              )}
              disabled={broadcasting}
              onClick={handleBroadcast}
            >
              <Users className="h-3.5 w-3.5" />
              {broadcasting ? "Envoi…" : broadcastOk ? "✓ Appliqué à tous" : "Appliquer à tous"}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
