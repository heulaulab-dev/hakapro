import { CircleSlash } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Calm placeholder for "nothing here" and "can't show this" states. */
export function EmptyState({ icon, title, description, action, className, compact }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string; compact?: boolean }) {
  return (
    <div role="status" className={cn("flex flex-col items-center justify-center gap-2 text-center", compact ? "py-6" : "py-12", className)}>
      <div className="text-muted-foreground [&_svg]:size-5">{icon ?? <CircleSlash />}</div>
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-sm text-xs text-muted-foreground">{description}</p>}
      {action}
    </div>
  );
}
