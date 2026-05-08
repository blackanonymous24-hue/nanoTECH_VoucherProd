import { Save, Sliders } from "lucide-react";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface PrintScaleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scaleSmall: number;
  scaleMobile: number;
  onScaleSmallChange: (v: number) => void;
  onScaleMobileChange: (v: number) => void;
  onSave?: () => void | Promise<void>;
}

const SECTIONS = [
  {
    label: "📄 Échelle — mode Small",
    hint: "2 colonnes MikHmon. Pré-sélectionnée à chaque impression Small.",
    color: "#7c3aed",
    key: "small" as const,
  },
  {
    label: "📱 Échelle — Mobile / APK",
    hint: "Safari iOS, Chrome Android et APK WebView.",
    color: "#16a34a",
    key: "mobile" as const,
  },
];

export function PrintScaleDialog({
  open,
  onOpenChange,
  scaleSmall,
  scaleMobile,
  onScaleSmallChange,
  onScaleMobileChange,
  onSave,
}: PrintScaleDialogProps) {
  const [saving, setSaving] = useState(false);
  const vals = { small: scaleSmall, mobile: scaleMobile };
  const handlers = { small: onScaleSmallChange, mobile: onScaleMobileChange };

  const handleSave = async () => {
    if (onSave) {
      setSaving(true);
      try { await onSave(); } finally { setSaving(false); }
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sliders className="h-4 w-4 text-purple-600" />
            Paramètres d'impression
          </DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-4">
          {SECTIONS.map((s, i) => {
            const val = vals[s.key];
            const onChange = handlers[s.key];
            return (
              <div key={s.key} className={`space-y-2 ${i > 0 ? "border-t pt-3" : ""}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-600">{s.label}</span>
                  <span className="text-sm font-bold tabular-nums" style={{ color: s.color }}>{val}%</span>
                </div>
                <p className="text-[11px] text-gray-400 leading-tight">{s.hint}</p>
                <input
                  type="range" min={0} max={100} step={1}
                  value={val}
                  onChange={(e) => onChange(Number(e.target.value))}
                  onWheel={(e) => {
                    e.preventDefault();
                    onChange(Math.min(100, Math.max(0, val + (e.deltaY < 0 ? 1 : -1))));
                  }}
                  className="w-full cursor-pointer"
                  style={{ accentColor: s.color }}
                />
                <div className="flex items-center gap-1.5">
                  <input
                    type="number" min={0} max={100} step={1}
                    value={val}
                    onChange={(e) => {
                      const raw = parseInt(e.target.value, 10);
                      if (!isNaN(raw)) onChange(Math.min(100, Math.max(0, raw)));
                    }}
                    className="w-12 text-center text-xs font-bold border border-gray-200 rounded px-1 py-1 focus:outline-none focus:ring-1"
                    style={{ "--tw-ring-color": s.color } as React.CSSProperties}
                  />
                  <span className="text-[10px] text-gray-400">%</span>
                </div>
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button size="sm" className="gap-1.5" disabled={saving} onClick={() => void handleSave()}>
            <Save className="h-3.5 w-3.5" />
            {saving ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
