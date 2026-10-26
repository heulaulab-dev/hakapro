import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * One horizontally scrollable row of controls on phones (snap, edge fade, bleeds to the screen
 * edge); wraps normally from `md` up. Replaces stacks of wrapped toggle groups that push the
 * content below the fold. Assumes the page gutter is 16px (`p-4`).
 */
export function ChipBar({ children, label, className, testId }: { children: ReactNode; label?: string; className?: string; testId?: string }) {
  return (
    <div
      role="group"
      aria-label={label}
      data-testid={testId}
      className={cn(
        "no-scrollbar -mx-4 flex snap-x snap-proximity scroll-px-4 items-center gap-2 overflow-x-auto overscroll-x-contain px-4 py-0.5",
        "[&>*]:shrink-0 [&>*]:snap-start",
        "max-md:[mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%-28px),transparent)]",
        "md:mx-0 md:flex-wrap md:overflow-visible md:px-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
