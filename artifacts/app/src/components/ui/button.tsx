import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 hover-elevate active-elevate-2",
  {
    variants: {
      variant: {
        default:
          "border-0 bg-gradient-to-r from-violet-600 to-violet-700 text-white shadow-sm shadow-violet-200/40 hover:from-violet-700 hover:to-violet-800",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm border border-destructive-border",
        outline:
          "border [border-color:var(--button-outline)] bg-background shadow-sm active:shadow-none",
        secondary:
          "border bg-secondary text-secondary-foreground border-secondary-border",
        ghost: "border border-transparent",
        link: "text-primary underline-offset-4 hover:underline",
        /** Actions secondaires teintées (ex. réinitialiser). */
        warning:
          "border border-amber-200/90 bg-amber-50/50 text-amber-800 shadow-sm hover:bg-amber-50",
        /** Outline violet (ex. échelle d’impression). */
        accentOutline:
          "border border-violet-200/90 bg-white text-violet-700 shadow-sm hover:bg-violet-50 hover:text-violet-800",
      },
      size: {
        default:
          "h-9 min-h-9 max-h-9 py-0 px-3 text-xs leading-none shadow-sm sm:min-h-9 sm:h-9 sm:px-4 sm:py-2 sm:text-sm",
        sm:
          "h-7 min-h-7 max-h-7 py-0 px-2.5 text-xs leading-none shadow-sm sm:min-h-7 sm:h-7 sm:px-3",
        lg: "h-10 min-h-10 py-0 px-6 text-sm sm:h-11 sm:px-8",
        icon: "h-8 w-8 min-h-8 max-h-8 p-0 sm:h-9 sm:w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
