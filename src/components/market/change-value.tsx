import { useLocale } from "next-intl";
import { direction, formatChange, formatPercent, type Locale } from "@/lib/format";
import { cn } from "@/lib/utils";

const COLOR = { positive: "text-positive", negative: "text-negative", neutral: "text-muted-foreground" } as const;
const GLYPH = { positive: "▲", negative: "▼", neutral: "" } as const;

/** Signed change with ▲/▼ glyph: direction is readable without color. */
export function ChangeValue({ percent, absolute, className }: { percent: number | null | undefined; absolute?: number | null; className?: string }) {
  const locale = useLocale() as Locale;
  const dir = direction(percent ?? absolute);
  return (
    <span data-direction={dir} className={cn("num inline-flex items-baseline gap-1 whitespace-nowrap", COLOR[dir], className)}>
      {GLYPH[dir] && <span aria-hidden className="text-[0.7em]">{GLYPH[dir]}</span>}
      {absolute !== undefined && <span>{formatChange(absolute, locale)}</span>}
      <span>{absolute !== undefined ? `(${formatPercent(percent, locale)})` : formatPercent(percent, locale)}</span>
    </span>
  );
}
