import { useEffect, useRef, useState } from "react";
import { Scaling } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import {
  getActiveVoucherPrintScaleProfile,
  getVoucherPrintScalePercentFor,
  setVoucherPrintScalePercentFor,
} from "@/lib/voucher-print-scale";
import { useAuth } from "@/contexts/AuthContext";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type VoucherPrintScaleButtonProps = {
  className?: string;
};

/**
 * Lit l'échelle depuis l'API au montage (sync multi-appareils) puis à chaque ouverture.
 * Sauvegarde en localStorage ET en base à chaque modification.
 */
export function VoucherPrintScaleButton({ className }: VoucherPrintScaleButtonProps) {
  const { token } = useAuth();
  const authHeaders = { Authorization: `Bearer ${token ?? ""}` };

  const [open, setOpen] = useState(false);
  const [activeProfile, setActiveProfile] = useState(() => getActiveVoucherPrintScaleProfile());
  const [pctWeb, setPctWeb] = useState(() => getVoucherPrintScalePercentFor("web"));
  const [pctMobile, setPctMobile] = useState(() => getVoucherPrintScalePercentFor("mobile"));
  const [synced, setSynced] = useState(false);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchFromServer = async () => {
    if (!token) return;
    try {
      const r = await fetch(`${BASE}/api/admin/print-scale`, { headers: authHeaders });
      if (!r.ok) return;
      const data = (await r.json()) as { scaleWeb: number | null; scaleMobile: number | null };
      if (data.scaleWeb !== null && data.scaleWeb !== undefined) {
        setVoucherPrintScalePercentFor("web", data.scaleWeb);
        setPctWeb(data.scaleWeb);
      }
      if (data.scaleMobile !== null && data.scaleMobile !== undefined) {
        setVoucherPrintScalePercentFor("mobile", data.scaleMobile);
        setPctMobile(data.scaleMobile);
      }
      setSynced(true);
    } catch {
      /* offline — localStorage conservé */
    }
  };

  const saveToServer = (web: number, mobile: number) => {
    if (!token) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      fetch(`${BASE}/api/admin/print-scale`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ scaleWeb: web, scaleMobile: mobile }),
      }).catch(() => { /* ignore réseau */ });
    }, 600);
  };

  useEffect(() => {
    fetchFromServer();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!open) return;
    setActiveProfile(getActiveVoucherPrintScaleProfile());
    fetchFromServer();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleWebChange = (v: number[]) => {
    const next = v[0] ?? 100;
    setPctWeb(next);
    setVoucherPrintScalePercentFor("web", next);
    saveToServer(next, pctMobile);
  };

  const handleMobileChange = (v: number[]) => {
    const next = v[0] ?? 100;
    setPctMobile(next);
    setVoucherPrintScalePercentFor("mobile", next);
    saveToServer(pctWeb, next);
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
              Mise à l&apos;échelle (Chrome / Edge)
            </Label>
            <p className="text-[11px] text-muted-foreground leading-snug">
              Réglages synchronisés entre tous vos appareils via le serveur.{" "}
              {synced && (
                <span className="text-green-600 font-medium">✓ synchronisé</span>
              )}
            </p>
          </div>

          <div className="space-y-2.5 rounded-md border bg-muted/20 p-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium leading-tight">Navigateur web (bureau)</span>
              <span className="text-xl font-semibold tabular-nums tracking-tight">{pctWeb}%</span>
            </div>
            <Slider
              min={0}
              max={100}
              step={1}
              value={[pctWeb]}
              onValueChange={handleWebChange}
            />
          </div>

          <div className="space-y-2.5 rounded-md border bg-muted/20 p-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium leading-tight">Mobile / APK</span>
              <span className="text-xl font-semibold tabular-nums tracking-tight">{pctMobile}%</span>
            </div>
            <Slider
              min={0}
              max={100}
              step={1}
              value={[pctMobile]}
              onValueChange={handleMobileChange}
            />
          </div>

          <p className="text-[10px] text-muted-foreground leading-snug border-t pt-2">
            Depuis cet appareil, l&apos;impression utilise actuellement l&apos;échelle{" "}
            <strong className="font-medium text-foreground">
              {activeProfile === "web" ? "Web" : "Mobile / APK"}
            </strong>
            .
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
