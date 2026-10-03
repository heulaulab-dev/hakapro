import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type StatusTone = "positive" | "negative" | "warning" | "info" | "neutral";

/** Reference Tag palette (heulaulab-dashboard kit/tag), keyed by meaning. */
const TONES: Record<StatusTone, string> = {
  positive: "border-(--tag-green-border) bg-(--tag-green-bg) text-(--tag-green-text)",
  negative: "border-(--tag-red-border) bg-(--tag-red-bg) text-(--tag-red-text)",
  warning: "border-(--tag-amber-border) bg-(--tag-amber-bg) text-(--tag-amber-text)",
  info: "border-(--tag-blue-border) bg-(--tag-blue-bg) text-(--tag-blue-text)",
  neutral: "border-(--tag-neutral-border) bg-(--tag-neutral-bg) text-(--tag-neutral-text)",
};

/**
 * Small semantic tag. Tone carries meaning only; pair it with words or an icon, never color alone.
 * Use FreshnessBadge (not this) for data freshness.
 */
export function StatusBadge({ tone = "neutral", icon, children, className, ...rest }: { tone?: StatusTone; icon?: ReactNode; children: ReactNode; className?: string } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span {...rest} data-tone={tone} className={cn("inline-flex h-[18px] shrink-0 items-center justify-center gap-1 rounded-full border px-1.5 text-[12px] leading-none whitespace-nowrap [&_svg]:size-3", TONES[tone], className)}>
      {icon}
      {children}
    </span>
  );
}
