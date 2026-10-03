import { cn } from "@/lib/utils"

type Tone = "auto" | "danger" | "warning" | "success" | "neutral"

const toneClass = { danger: "bg-danger", warning: "bg-warning", success: "bg-success", neutral: "bg-soft" }

/**
 * Segmented meter from the reference. `auto` colors by position: the first quarter red,
 * then amber, then green — so low values read red and high values sweep into green.
 */
export function Meter({
  value,
  segments = 17,
  tone = "auto",
  size = "sm",
  className,
  label,
}: {
  value: number
  segments?: number
  tone?: Tone
  size?: "sm" | "lg"
  className?: string
  label?: string
}) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
  const filled = Math.round((pct / 100) * segments)
  const redEnd = Math.round(segments * 0.24)
  const amberEnd = Math.round(segments * 0.53)
  return (
    <span
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label}
      className={cn(
        "flex items-center gap-[2px] overflow-hidden rounded-[2px] bg-white/8",
        size === "sm" ? "h-[14px] w-[74px] px-[2px]" : "h-3 w-full border border-white/4 px-px",
        className,
      )}
    >
      {Array.from({ length: segments }, (_, i) => {
        const on = i < filled
        const color = !on
          ? size === "sm"
            ? "bg-track"
            : "bg-white/8"
          : tone === "auto"
            ? i < redEnd
              ? "bg-danger"
              : i < amberEnd
                ? "bg-warning"
                : "bg-success"
            : toneClass[tone]
        return (
          <span
            key={i}
            className={cn("min-w-px flex-1 rounded-[1px]", size === "sm" ? "h-[10px]" : "h-2", color)}
          />
        )
      })}
    </span>
  )
}

export function MeterWithValue({ value, ...props }: React.ComponentProps<typeof Meter>) {
  return (
    <span className="flex items-center gap-2">
      <Meter value={value} {...props} />
      <span className="w-[4ch] text-right tabular-nums">{Math.round(value)}%</span>
    </span>
  )
}
