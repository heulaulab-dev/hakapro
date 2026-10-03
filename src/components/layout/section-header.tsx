import type { ReactNode } from "react";
import { FreshnessBadge } from "@/components/feedback/freshness-badge";
import type { FreshnessMeta } from "@/lib/freshness";
import { cn } from "@/lib/utils";

/** Title row for a page section: title, optional description, freshness and actions. */
export function SectionHeader({ title, description, meta, actions, as: Heading = "h2", className }: {
  title: ReactNode;
  description?: ReactNode;
  meta?: FreshnessMeta;
  actions?: ReactNode;
  as?: "h1" | "h2" | "h3";
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-2", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Heading className={cn(Heading === "h1" ? "h1-style" : Heading === "h2" ? "h2-style" : "eyebrow-style text-soft")}>{title}</Heading>
          {meta && <FreshnessBadge {...meta} />}
        </div>
        {description && <p className="caption-style leading-snug text-subtle">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
