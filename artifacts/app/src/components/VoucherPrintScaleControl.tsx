import { useEffect, useRef, useState } from "react";
import { Scaling } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  VOUCHER_PRINT_SCALE_MIN,
  VOUCHER_PRINT_SCALE_MAX,
  VOUCHER_PRINT_SCALE_DEFAULT,
  formatVoucherPrintScaleLabel,
  getVoucherPrintScaleDesktop,
  getVoucherPrintScaleMobile,
  setVoucherPrintScaleDesktop,
  setVoucherPrintScaleMobile,
} from "@/lib/voucher-print-scale";

const WHEEL_STEP = 5;

type ScaleSliderProps = {
  label: string;
  value: number;
  onChange: (v: number) => void;
};

function ScaleSlider({ label, value, onChange }: ScaleSliderProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? WHEEL_STEP : -WHEEL_STEP;
      const next = Math.min(VOUCHER_PRINT_SCALE_MAX, Math.max(VOUCHER_PRINT_SCALE_MIN, value + delta));
      onChange(next);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [value, onChange]);

  const pct = ((value - VOUCHER_PRINT_SCALE_MIN) / (VOUCHER_PRINT_SCALE_MAX - VOUCHER_PRINT_SCALE_MIN)) * 100;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-[11px] text-gray-600">{label}</Label>
        <span
          className={cn(
            "min-w-[2.8rem] rounded px-1 py-0.5 text-center font-mono text-xs font-semibold tabular-nums",
            value === VOUCHER_PRINT_SCALE_DEFAULT
              ? "bg-gray-100 text-gray-500"
              : value < VOUCHER_PRINT_SCALE_DEFAULT
              ? "bg-amber-50 text-amber-700"
              : "bg-violet-50 text-violet-700",
          )}
        >
          {value} %
        </span>
      </div>
      <div className="relative flex items-center gap-1.5">
        <span className="text-[9px] font-mono text-gray-400">{VOUCHER_PRINT_SCALE_MIN}%</span>
        <input
          ref={inputRef}
          type="range"
          min={VOUCHER_PRINT_SCALE_MIN}
          max={VOUCHER_PRINT_SCALE_MAX}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-gray-200 accent-violet-600"
          style={{
            background: `linear-gradient(to right, #7c3aed ${pct}%, #e5e7eb ${pct}%)`,
          }}
        />
        <span className="text-[9px] font-mono text-gray-400">{VOUCHER_PRINT_SCALE_MAX}%</span>
      </div>
    </div>
  );
}

type VoucherPrintScaleControlProps = {
  className?: string;
};

export function VoucherPrintScaleControl({ className }: VoucherPrintScaleControlProps) {
  const [open, setOpen] = useState(false);
  const [desktop, setDesktop] = useState<number>(() => getVoucherPrintScaleDesktop());
  const [mobile, setMobile] = useState<number>(() => getVoucherPrintScaleMobile());

  useEffect(() => {
    if (!open) return;
    setDesktop(getVoucherPrintScaleDesktop());
    setMobile(getVoucherPrintScaleMobile());
  }, [open]);

  const onDesktop = (v: number) => {
    setDesktop(v);
    setVoucherPrintScaleDesktop(v);
  };

  const onMobile = (v: number) => {
    setMobile(v);
    setVoucherPrintScaleMobile(v);
  };

  const handleReset = () => {
    onDesktop(VOUCHER_PRINT_SCALE_DEFAULT);
    onMobile(VOUCHER_PRINT_SCALE_DEFAULT);
  };

  const isDefault = desktop === VOUCHER_PRINT_SCALE_DEFAULT && mobile === VOUCHER_PRINT_SCALE_DEFAULT;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            "h-8 shrink-0 gap-1.5 border-violet-200 text-xs text-violet-800 hover:bg-violet-50",
            !isDefault && "border-violet-400 bg-violet-50",
            className,
          )}
          aria-label="Mise à l'échelle des tickets à l'impression"
        >
          <Scaling className="h-3.5 w-3.5 shrink-0" />
          Échelle
          {!isDefault && (
            <span className="font-mono font-semibold text-violet-700">
              ·
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-4 p-3" align="start">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-gray-800">Impression des vouchers</p>
          {!isDefault && (
            <button
              type="button"
              onClick={handleReset}
              className="text-[10px] text-gray-400 underline-offset-2 hover:text-gray-600 hover:underline"
            >
              Réinitialiser
            </button>
          )}
        </div>

        <ScaleSlider
          label="Bureau (navigateur desktop)"
          value={desktop}
          onChange={onDesktop}
        />

        <ScaleSlider
          label="Mobile (téléphone / tablette)"
          value={mobile}
          onChange={onMobile}
        />

        <p className="text-[10px] leading-snug text-gray-500">
          Faites défiler la molette sur la barre pour ajuster finement. S'applique à la prochaine impression. 100 % = taille d'origine.
        </p>
      </PopoverContent>
    </Popover>
  );
}
