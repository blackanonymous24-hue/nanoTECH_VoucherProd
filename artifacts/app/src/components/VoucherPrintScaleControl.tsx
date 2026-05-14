import { useEffect, useState } from "react";
import { Scaling } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  VOUCHER_PRINT_SCALE_CHOICES,
  formatVoucherPrintScaleLabel,
  getVoucherPrintScaleDesktop,
  getVoucherPrintScaleMobile,
  setVoucherPrintScaleDesktop,
  setVoucherPrintScaleMobile,
  type VoucherPrintScaleChoice,
} from "@/lib/voucher-print-scale";

type VoucherPrintScaleControlProps = {
  className?: string;
};

export function VoucherPrintScaleControl({ className }: VoucherPrintScaleControlProps) {
  const [open, setOpen] = useState(false);
  const [desktop, setDesktop] = useState<VoucherPrintScaleChoice>(() => getVoucherPrintScaleDesktop());
  const [mobile, setMobile] = useState<VoucherPrintScaleChoice>(() => getVoucherPrintScaleMobile());

  useEffect(() => {
    if (!open) return;
    setDesktop(getVoucherPrintScaleDesktop());
    setMobile(getVoucherPrintScaleMobile());
  }, [open]);

  const onDesktop = (v: string) => {
    const n = Number.parseFloat(v) as VoucherPrintScaleChoice;
    setDesktop(n);
    setVoucherPrintScaleDesktop(n);
  };

  const onMobile = (v: string) => {
    const n = Number.parseFloat(v) as VoucherPrintScaleChoice;
    setMobile(n);
    setVoucherPrintScaleMobile(n);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            "h-8 shrink-0 gap-1.5 border-violet-200 text-xs text-violet-800 hover:bg-violet-50",
            className,
          )}
          aria-label="Mise à l’échelle des tickets à l’impression"
        >
          <Scaling className="h-3.5 w-3.5 shrink-0" />
          Échelle
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-3 p-3" align="start">
        <p className="text-xs font-medium text-gray-800">Impression des vouchers</p>
        <div className="space-y-1.5">
          <Label className="text-[11px] text-gray-600">Bureau (navigateur desktop)</Label>
          <Select value={String(desktop)} onValueChange={onDesktop}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VOUCHER_PRINT_SCALE_CHOICES.map((s) => (
                <SelectItem key={`d-${s}`} value={String(s)} className="text-xs">
                  {formatVoucherPrintScaleLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-[11px] text-gray-600">Mobile (téléphone / tablette)</Label>
          <Select value={String(mobile)} onValueChange={onMobile}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VOUCHER_PRINT_SCALE_CHOICES.map((s) => (
                <SelectItem key={`m-${s}`} value={String(s)} className="text-xs">
                  {formatVoucherPrintScaleLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-[10px] leading-snug text-gray-500">
          Comme la mise à l’échelle du dialogue d’impression du navigateur (zoom de la page). S’applique à la prochaine
          impression ; 100 % = taille d’origine.
        </p>
      </PopoverContent>
    </Popover>
  );
}
