import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"

/** Durée d’affichage des toasts — à garder alignée avec les délais de fermeture de dialogs (ex. prolonger / réinitialiser). */
export const TOAST_PROVIDER_DURATION_MS = 3000

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider duration={TOAST_PROVIDER_DURATION_MS}>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
