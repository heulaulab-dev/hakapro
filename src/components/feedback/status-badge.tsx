import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type StatusTone = "positive" | "negative" | "warning" | "info" | "neutral";

const TONES: Record<StatusTone, string> = {
  positive: "bg-positive-muted text-positive",
  negative: "bg-negative-muted text-negative",
  warning: "bg-warning-muted text-warning",
  info: "bg-info-muted text-info",
  neutral: "bg-muted text-muted-foreground",
};

/**
 * Small semantic label. Tone carries meaning only; pair it with words or an icon, never color alone.
 * Use FreshnessBadge (not this) for data freshness.
 */
export function StatusBadge({ tone = "neutral", icon, children, className, ...rest }: { tone?: StatusTone; icon?: ReactNode; children: ReactNode; className?: string } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span {...rest} data-tone={tone} className={cn("inline-flex h-5 shrink-0 items-center gap-1 rounded-sm px-1.5 text-[11px] font-medium leading-none whitespace-nowrap [&_svg]:size-3", TONES[tone], className)}>
      {icon}
      {children}
    </span>
  );
}
