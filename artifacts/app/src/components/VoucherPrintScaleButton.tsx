import { useEffect, useState } from "react";
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

type VoucherPrintScaleButtonProps = {
  className?: string;
};

/**
 * « Scale Impression » : deux réglages 0–100 % (web et mobile / APK), sauvegarde localStorage,
 * appliqué à l’impression via `zoom` sur `html` (voir `print.ts`).
 */
export function VoucherPrintScaleButton({ className }: VoucherPrintScaleButtonProps) {
  const [open, setOpen] = useState(false);
  const [activeProfile, setActiveProfile] = useState(() => getActiveVoucherPrintScaleProfile());
  const [pctWeb, setPctWeb] = useState(() => getVoucherPrintScalePercentFor("web"));
  const [pctMobile, setPctMobile] = useState(() => getVoucherPrintScalePercentFor("mobile"));

  useEffect(() => {
    if (!open) return;
    setActiveProfile(getActiveVoucherPrintScaleProfile());
    setPctWeb(getVoucherPrintScalePercentFor("web"));
    setPctMobile(getVoucherPrintScalePercentFor("mobile"));
  }, [open]);

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
              Comme « Mise à l&apos;échelle » dans le dialogue d&apos;impression :{" "}
              <code className="rounded bg-muted px-0.5 font-mono text-[10px]">zoom:</code> sur{" "}
              <code className="rounded bg-muted px-0.5 font-mono text-[10px]">html</code>. Réglez les deux
              profils ci-dessous ; chacun est enregistré sur cet appareil.
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
              onValueChange={(v) => {
                const next = v[0] ?? 100;
                setPctWeb(next);
                setVoucherPrintScalePercentFor("web", next);
              }}
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
              onValueChange={(v) => {
                const next = v[0] ?? 100;
                setPctMobile(next);
                setVoucherPrintScalePercentFor("mobile", next);
              }}
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
