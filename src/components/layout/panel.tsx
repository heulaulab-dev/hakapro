import type { ReactNode } from "react";
import { FreshnessBadge } from "@/components/feedback/freshness-badge";
import type { FreshnessMeta } from "@/lib/freshness";
import { cn } from "@/lib/utils";

/**
 * heulaulab-dashboard's Section: rounded-xl hairline frame, 48px header with an eyebrow title,
 * optional freshness and actions, padded body.
 */
export function Panel({ title, meta, description, actions, children, className, bodyClassName, testId }: {
  title: ReactNode;
  meta?: FreshnessMeta;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  testId?: string;
}) {
  return (
    <section data-testid={testId} className={cn("flex min-w-0 flex-col rounded-xl border border-border", className)}>
      <div className="flex min-h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="eyebrow-style truncate font-normal text-soft">{title}</h3>
          {meta && <FreshnessBadge {...meta} />}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <div className={cn("flex min-w-0 flex-1 flex-col gap-3 p-4", bodyClassName)}>
        {description && <p className="caption-style leading-snug text-subtle">{description}</p>}
        {children}
      </div>
    </section>
  );
}
