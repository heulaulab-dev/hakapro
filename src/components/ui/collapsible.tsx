"use client"

import * as React from "react"
import { Collapsible as CollapsiblePrimitive } from "radix-ui"
import { cn } from "@/lib/utils"
import { ChevronDown } from "@/components/kit/icons"

function Collapsible(props: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

/**
 * Disclosure trigger with a rotating chevron. Pass `chevron={false}` for a custom affordance.
 */
function CollapsibleTrigger({
  className,
  children,
  chevron = true,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Trigger> & { chevron?: boolean }) {
  return (
    <CollapsiblePrimitive.Trigger
      data-slot="collapsible-trigger"
      className={cn(
        "group/collapsible inline-flex items-center gap-1.5 rounded-md text-left outline-none transition-colors duration-150 ease-power3-out focus-visible:ring-2 focus-visible:ring-ring/60",
        className,
      )}
      {...props}
    >
      {children}
      {chevron && (
        <ChevronDown className="size-3.5 shrink-0 text-subtle transition-transform duration-200 ease-power3-out group-data-[state=open]/collapsible:rotate-180" />
      )}
    </CollapsiblePrimitive.Trigger>
  )
}

/** Height-animated content (uses Radix's measured `--radix-collapsible-content-height`). */
function CollapsibleContent({ className, ...props }: React.ComponentProps<typeof CollapsiblePrimitive.Content>) {
  return (
    <CollapsiblePrimitive.Content
      data-slot="collapsible-content"
      className={cn(
        "overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down",
        className,
      )}
      {...props}
    />
  )
}

export { Collapsible, CollapsibleContent, CollapsibleTrigger }
