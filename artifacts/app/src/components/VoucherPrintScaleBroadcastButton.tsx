import { useState } from "react";
import { Scaling, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { getVoucherPrintScalePercent } from "@/lib/voucher-print-scale";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type VoucherPrintScaleBroadcastButtonProps = {
  templateId: string;
  className?: string;
};

/**
 * Diffuse l’échelle du template sélectionné à tous les comptes (super admin).
 * Séparé du réglage personnel dans VoucherPrintScaleButton.
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

  if (!isSuperAdmin) return null;

  const isBuiltIn = templateId !== "custom";
  const pct = getVoucherPrintScalePercent(templateId);
  const templateLabel =
    templateId === "custom" ? "Modèle personnalisé" : templateId;

  const handleBroadcast = async () => {
    if (!token || broadcasting || !isBuiltIn) return;
    setBroadcasting(true);
    try {
      const r = await fetch(`${BASE}/api/admin/print-scale/broadcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ templateId }),
      });
      if (r.ok) {
        toast({
          title: "Échelle diffusée",
          description: `${pct}% appliqué à tous les comptes pour « ${templateLabel} ».`,
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
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
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
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Appliquer à tous les comptes</AlertDialogTitle>
          <AlertDialogDescription>
            L’échelle <strong>{pct}%</strong> du template{" "}
            <strong>{templateLabel}</strong> sera enregistrée pour{" "}
            <strong>tous les comptes</strong> de la plateforme.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={broadcasting}>Annuler</AlertDialogCancel>
          <AlertDialogAction
            disabled={broadcasting}
            onClick={(e) => {
              e.preventDefault();
              void handleBroadcast();
            }}
          >
            {broadcasting ? (
              <>
                <Loader2 className="animate-spin" />
                Diffusion…
              </>
            ) : (
              "Confirmer"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
