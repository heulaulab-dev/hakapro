"use client"

import { cn } from "@/lib/utils"

/** Pill segmented control in the reference's raised style. */
export function Segmented<V extends string>({
  value,
  options,
  onChange,
  className,
  size = "sm",
}: {
  value: V
  options: { value: V; label: React.ReactNode }[]
  onChange: (value: V) => void
  className?: string
  size?: "sm" | "md"
}) {
  return (
    <div
      role="radiogroup"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full bg-secondary p-0.5 shadow-[0px_0px_0px_1px_rgba(0,0,0,0.4),inset_0px_1px_0px_0px_rgba(255,255,255,0.1),inset_0px_0px_0px_1px_rgba(255,255,255,0.06)]",
        className,
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          data-active={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "cursor-pointer rounded-full leading-none text-subtle outline-none transition-[background-color,color] duration-150 ease-power3-out hover:text-soft focus-visible:ring-2 focus-visible:ring-ring/60 data-[active=true]:bg-muted data-[active=true]:text-foreground data-[active=true]:shadow-[inset_0px_1px_0px_0px_rgba(255,255,255,0.08)]",
            size === "sm" ? "px-2.5 py-[6px] text-[12px]" : "px-3 py-2 text-[13px]",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
