"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-[18px] w-[30px] shrink-0 cursor-pointer items-center rounded-full bg-track p-[2px] outline-none transition-colors duration-150 ease-power3-out focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-status",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-[14px] rounded-full bg-foreground shadow-[0px_1px_3px_rgba(0,0,0,0.5)] transition-transform duration-150 ease-power3-out data-[state=checked]:translate-x-3" />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
