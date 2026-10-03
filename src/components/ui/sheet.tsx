"use client"

import * as React from "react"
import { Dialog as SheetPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"
import { X } from "@/components/kit/icons"

function Sheet(props: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger(props: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose(props: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetOverlay({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/60 backdrop-blur-[6px] duration-350 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-250 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & { side?: "right" | "left" | "bottom" }) {
  return (
    <SheetPrimitive.Portal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "fixed inset-y-0 z-50 flex h-dvh w-full flex-col border-line-strong bg-background text-foreground outline-none duration-350 data-[state=closed]:animate-out data-[state=closed]:ease-power3-in data-[state=closed]:duration-250 data-[state=open]:animate-in data-[state=open]:ease-power3-out sm:w-[560px] sm:max-w-[560px]",
          side === "right" &&
            "right-0 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
          side === "left" &&
            "left-0 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left",
          // HAKAPRO addition: mobile bottom sheet in the same surface/border language.
          side === "bottom" &&
            "inset-x-0 top-auto bottom-0 h-auto max-h-[85dvh] rounded-t-2xl border-t sm:w-full sm:max-w-none data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
          className,
        )}
        {...props}
      >
        {children}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  )
}

function SheetHeader({
  className,
  icon,
  title,
  description,
  actions,
}: {
  className?: string
  icon?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div
      data-slot="sheet-header"
      className={cn(
        "flex h-14 shrink-0 items-center justify-between gap-2 border-b border-line-strong px-6",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2 [&_svg]:size-3.5 [&_svg]:text-icon">
        {icon}
        <SheetPrimitive.Title className="lead-style truncate">{title}</SheetPrimitive.Title>
      </div>
      <SheetPrimitive.Description className="sr-only">{description ?? title}</SheetPrimitive.Description>
      <div className="flex items-center gap-1">
        {actions}
        <SheetPrimitive.Close
          className="-mr-1 inline-flex size-6 items-center justify-center rounded-full text-subtle outline-none transition-colors duration-150 hover:bg-white/6 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
          aria-label="Close"
        >
          <X className="size-3.5" />
        </SheetPrimitive.Close>
      </div>
    </div>
  )
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return <SheetPrimitive.Title className={cn("lead-style", className)} {...props} />
}

function SheetBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="sheet-body" className={cn("min-h-0 flex-1 overflow-y-auto", className)} {...props} />
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn(
        "flex h-[62px] shrink-0 items-center justify-between gap-2 border-t border-line-strong px-6",
        className,
      )}
      {...props}
    />
  )
}

/** Section block inside a sheet, divided by an inset hairline. */
function SheetSection({
  title,
  action,
  className,
  children,
}: {
  title?: React.ReactNode
  action?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={cn("flex flex-col gap-4 p-5 shadow-[inset_0_-1px_0_var(--line-strong)] last:shadow-none", className)}>
      {title || action ? (
        <div className={cn("flex items-center justify-between gap-2", action && "h-[30px]")}>
          {title ? <h4 className="eyebrow-style font-normal">{title}</h4> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  )
}

export { Sheet, SheetBody, SheetClose, SheetContent, SheetFooter, SheetHeader, SheetSection, SheetTitle, SheetTrigger }
