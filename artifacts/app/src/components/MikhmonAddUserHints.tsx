import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getMikhmonAddUserUiState } from "@/lib/mikhmon-add-user";

interface MikhmonAddUserHintsProps {
  name: string;
  password: string;
  comment: string;
  disabled?: boolean;
  onSyncPasswordToName?: () => void;
}

/** Bannière mode voucher/compte + aperçu commentaire MikHmon adduser.php. */
export function MikhmonAddUserHints({
  name,
  password,
  comment,
  disabled,
  onSyncPasswordToName,
}: MikhmonAddUserHintsProps) {
  const ui = getMikhmonAddUserUiState(name, password, comment);

  return (
    <div className="space-y-1.5 rounded-md border border-slate-600 bg-slate-800/80 px-2.5 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={
            ui.isVoucher
              ? "rounded px-1.5 py-0.5 font-semibold bg-emerald-900/50 text-emerald-300 border border-emerald-700"
              : "rounded px-1.5 py-0.5 font-semibold bg-blue-900/50 text-blue-300 border border-blue-700"
          }
        >
          {ui.modeLabel}
        </span>
        {ui.isVoucher && onSyncPasswordToName && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || !name}
            onClick={onSyncPasswordToName}
            className="h-6 text-[10px] px-2 bg-slate-700 border-slate-500 text-slate-200 hover:bg-slate-600"
          >
            <Link2 className="h-3 w-3 mr-1" />
            Mot de passe = nom
          </Button>
        )}
      </div>
      <p className="text-slate-300 leading-snug">{ui.portalHint}</p>
      <p className="text-slate-400 leading-snug">
        Commentaire MikroTik :{" "}
        <span className="font-mono text-amber-200/90">{ui.finalComment || "—"}</span>
      </p>
      <p className="text-slate-500 text-[10px]">{ui.commentHint}</p>
    </div>
  );
}
