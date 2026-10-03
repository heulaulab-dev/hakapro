import { CircleSlash } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Calm placeholder for "nothing here" and "can't show this" states. */
export function EmptyState({ icon, title, description, action, className, compact }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string; compact?: boolean }) {
  return (
    <div role="status" className={cn("flex flex-col items-center justify-center gap-2 text-center", compact ? "py-6" : "py-12", className)}>
      <div className="flex size-8 items-center justify-center rounded-lg bg-muted text-icon shadow-[0px_0px_0px_1px_var(--border)] [&_svg]:size-3.5">{icon ?? <CircleSlash />}</div>
      <p className="lead-style font-medium">{title}</p>
      {description && <p className="caption-style max-w-sm leading-snug text-subtle">{description}</p>}
      {action}
    </div>
  );
}
