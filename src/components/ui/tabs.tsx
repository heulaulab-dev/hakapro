"use client"

import * as React from "react"
import { Tabs as TabsPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col", className)} {...props} />
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn("no-scrollbar flex items-center gap-4 overflow-x-auto border-b border-border px-4", className)}
      {...props}
    />
  )
}

/** Underline tab; a hidden bold copy reserves width so the label doesn't shift when active. */
const tabTriggerClass =
  "group caption-style -mb-px grid shrink-0 cursor-pointer border-b border-transparent py-4 text-center text-subtle outline-none select-none transition-[color,border-color] duration-150 ease-power3-out hover:text-soft focus-visible:text-foreground data-[state=active]:border-foreground data-[state=active]:text-foreground data-[active=true]:border-foreground data-[active=true]:text-foreground"

function TabLabel({ children }: { children: React.ReactNode }) {
  return (
    <>
      <span aria-hidden="true" className="invisible col-start-1 row-start-1 font-medium">
        {children}
      </span>
      <span className="col-start-1 row-start-1 group-data-[active=true]:font-medium group-data-[state=active]:font-medium">
        {children}
      </span>
    </>
  )
}

function TabsTrigger({ className, children, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger data-slot="tabs-trigger" className={cn(tabTriggerClass, className)} {...props}>
      <TabLabel>{children}</TabLabel>
    </TabsPrimitive.Trigger>
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn("outline-none", className)} {...props} />
}

export { TabLabel, tabTriggerClass, Tabs, TabsContent, TabsList, TabsTrigger }
