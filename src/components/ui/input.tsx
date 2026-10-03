import * as React from "react"
import { cn } from "@/lib/utils"

const fieldBase =
  "flex w-full min-w-0 rounded-lg border border-line-strong bg-secondary px-3 text-[14px] text-foreground outline-none transition-[border-color] duration-150 ease-power3-out placeholder:text-subtle focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      autoComplete="off"
      className={cn(fieldBase, "h-9 leading-none file:border-0 file:bg-transparent", className)}
      {...props}
    />
  )
}

/** Input with a fixed prefix such as a currency symbol. */
function AffixInput({
  prefix,
  suffix,
  className,
  ...props
}: React.ComponentProps<"input"> & { prefix?: React.ReactNode; suffix?: React.ReactNode }) {
  return (
    <div className="relative">
      {prefix ? (
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[14px] leading-none text-subtle">
          {prefix}
        </span>
      ) : null}
      <Input
        className={cn(prefix ? "pl-8" : undefined, suffix ? "pr-10" : undefined, "tabular-nums", className)}
        {...props}
      />
      {suffix ? (
        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[14px] leading-none text-subtle">
          {suffix}
        </span>
      ) : null}
    </div>
  )
}

export { AffixInput, fieldBase, Input }
