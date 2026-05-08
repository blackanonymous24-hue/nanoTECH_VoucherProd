import * as React from "react"
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog"
import { Trash2, AlertTriangle, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

export interface DeleteConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: React.ReactNode
  onConfirm: () => void
  loading?: boolean
  confirmLabel?: string
  icon?: "trash" | "warning"
}

export function DeleteConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  loading = false,
  confirmLabel = "Supprimer",
  icon = "trash",
}: DeleteConfirmDialogProps) {
  const Icon = icon === "warning" ? AlertTriangle : Trash2

  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={(o) => { if (!loading) onOpenChange(o); }}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <AlertDialogPrimitive.Content
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={cn(
            "fixed left-[50%] top-[50%] z-50 w-[calc(100vw-2rem)] max-w-[20rem] translate-x-[-50%] translate-y-[-50%]",
            "rounded-2xl border bg-background shadow-2xl overflow-hidden",
            "duration-150 data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          )}
        >
          <div className="px-6 pt-6 pb-5 flex flex-col items-center text-center gap-2.5">
            <div className={cn(
              "h-12 w-12 rounded-full flex items-center justify-center flex-shrink-0",
              icon === "warning" ? "bg-amber-100" : "bg-red-100",
            )}>
              <Icon className={cn(
                "h-5 w-5",
                icon === "warning" ? "text-amber-600" : "text-red-600",
              )} />
            </div>
            <AlertDialogPrimitive.Title className="text-[15px] font-semibold text-foreground leading-snug">
              {title}
            </AlertDialogPrimitive.Title>
            {description && (
              <AlertDialogPrimitive.Description className="text-[13px] text-muted-foreground leading-relaxed">
                {description}
              </AlertDialogPrimitive.Description>
            )}
          </div>

          <div className="border-t grid grid-cols-2 divide-x">
            <AlertDialogPrimitive.Cancel
              disabled={loading}
              className="h-11 text-sm font-medium text-foreground hover:bg-muted/60 transition-colors disabled:opacity-50 focus-visible:outline-none"
            >
              Annuler
            </AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action
              onClick={onConfirm}
              disabled={loading}
              className={cn(
                "h-11 text-sm font-semibold transition-colors disabled:opacity-50 focus-visible:outline-none inline-flex items-center justify-center gap-1.5",
                icon === "warning"
                  ? "text-amber-600 hover:bg-amber-50"
                  : "text-red-600 hover:bg-red-50",
              )}
            >
              {loading
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />{confirmLabel}…</>
                : confirmLabel}
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  )
}
