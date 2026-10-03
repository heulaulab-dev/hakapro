import type { ReactNode } from "react";
import type { StatusTone } from "@/components/feedback/status-badge";
import { SectionHeader } from "@/components/layout/section-header";
import type { FreshnessMeta } from "@/lib/freshness";
import { cn } from "@/lib/utils";

export type Observation = { id: string; text: ReactNode; tone?: StatusTone };

const DOT: Record<StatusTone, string> = { positive: "bg-positive", negative: "bg-negative", warning: "bg-warning", info: "bg-info", neutral: "bg-neutral" };

/**
 * A short list of observed facts ("foreign investors were net sellers in 5 of the last 5 sessions").
 * Observations describe data; they never recommend an action.
 */
export function InsightCard({ title, description, observations, meta, footer, className }: {
  title: ReactNode;
  description?: ReactNode;
  observations: Observation[];
  meta: FreshnessMeta;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-3 rounded-lg border border-border bg-card p-4", className)}>
      <SectionHeader as="h3" title={title} description={description} meta={meta} />
      <ul className="flex flex-col gap-2">
        {observations.map((observation) => (
          <li key={observation.id} className="flex items-start gap-2 text-sm">
            <span aria-hidden className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", DOT[observation.tone ?? "neutral"])} />
            <span>{observation.text}</span>
          </li>
        ))}
      </ul>
      {footer && <div className="border-t border-border pt-3 text-xs text-muted-foreground">{footer}</div>}
    </section>
  );
}
