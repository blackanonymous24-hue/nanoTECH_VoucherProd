import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Liste déroulante dans un Popover (scroll molette + tactile, y compris dans un Dialog). */
export function ScrollablePopoverList({
  children,
  className,
  maxHeightClass = "max-h-60",
}: {
  children: ReactNode;
  className?: string;
  maxHeightClass?: string;
}) {
  return (
    <div
      data-scroll-lock-scrollable
      className={cn(
        "overflow-y-auto overflow-x-hidden overscroll-contain touch-pan-y",
        "[-webkit-overflow-scrolling:touch]",
        maxHeightClass,
        className,
      )}
      onWheel={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}
