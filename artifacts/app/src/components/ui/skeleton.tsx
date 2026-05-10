import { cn } from "@/lib/utils"

/** Même effet shimmer que le chargement plein écran (voir `PageSkeleton` dans App.tsx). */
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("skeleton rounded-md", className)}
      {...props}
    />
  )
}

export { Skeleton }
