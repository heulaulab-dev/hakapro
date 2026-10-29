"use client"

import * as React from "react"
import { Slider as SliderPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

/** Range input on Radix Slider: keyboard (arrows, Page, Home/End), touch and pointer, one or two thumbs. */
function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  "aria-label": ariaLabel,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  const thumbs = React.useMemo(
    () => (Array.isArray(value) ? value : Array.isArray(defaultValue) ? defaultValue : [min]),
    [value, defaultValue, min],
  )
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        "relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-40 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col",
        "h-5 pointer-coarse:h-10",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative grow overflow-hidden rounded-full bg-track shadow-[inset_0_1px_1px_rgb(0_0_0/0.25)] data-[orientation=horizontal]:h-1.5 data-[orientation=vertical]:w-1.5"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="absolute bg-linear-to-r from-primary/70 to-primary data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
        />
      </SliderPrimitive.Track>
      {thumbs.map((_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          aria-label={ariaLabel}
          className="block size-4 shrink-0 rounded-full border-2 border-background bg-foreground shadow-[0_0_0_4px_color-mix(in_oklab,var(--primary)_22%,transparent),0_2px_6px_rgb(0_0_0/0.35)] outline-none transition-[box-shadow,transform] duration-150 ease-power3-out hover:scale-110 focus-visible:shadow-[0_0_0_6px_color-mix(in_oklab,var(--primary)_40%,transparent)] active:scale-95 disabled:pointer-events-none"
        />
      ))}
    </SliderPrimitive.Root>
  )
}

export { Slider }
