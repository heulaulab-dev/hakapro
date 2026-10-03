import { cn } from "@/lib/utils"

/** Mini bar trend from the reference: bright bars where activity grew, muted where it dipped. */
export function Sparkline({
  values,
  height = 14,
  className,
}: {
  values: number[]
  height?: number
  className?: string
}) {
  const max = Math.max(1, ...values)
  return (
    <span aria-hidden="true" className={cn("flex items-end gap-px", className)} style={{ height }}>
      {values.map((v, i) => {
        const h = v <= 0 ? 1 : Math.max(2, Math.round((v / max) * height))
        const up = i === 0 || v >= values[i - 1]
        return (
          <span
            key={i}
            className={cn("w-1 shrink-0 rounded-[1px]", up && v > 0 ? "bg-trend" : "bg-trend-muted")}
            style={{ height: h }}
          />
        )
      })}
    </span>
  )
}
