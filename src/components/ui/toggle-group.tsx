"use client"

import * as React from "react"
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

/**
 * Radix ToggleGroup wearing heulaulab-dashboard's Segmented style (raised pill track, active item
 * on --muted). `variant`/`size` are accepted for API compatibility; the look is fixed by the system.
 */
type Compat = { variant?: string; size?: string }

const raised =
  "shadow-(--shadow-raised)"

function ToggleGroup({ className, variant: _variant, size: _size, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Root> & Compat) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn("inline-flex w-fit items-center gap-0.5 rounded-full bg-secondary p-0.5", raised, className)}
      {...props}
    />
  )
}

function ToggleGroupItem({ className, variant: _variant, size: _size, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Item> & Compat) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(
        "cursor-pointer rounded-full px-2.5 py-[6px] text-[12px] leading-none text-subtle outline-none transition-[background-color,color] duration-150 ease-power3-out hover:text-soft focus-visible:ring-2 focus-visible:ring-ring/60 data-[state=on]:bg-muted data-[state=on]:text-foreground data-[state=on]:shadow-(--shadow-active)",
        className,
      )}
      {...props}
    />
  )
}

export { ToggleGroup, ToggleGroupItem }
