import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"
import { cn } from "@/lib/utils"

// Shadows and sizes copied from the reference CRM's buttons.
const raised =
  "shadow-(--shadow-raised)"

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-medium leading-none outline-none select-none transition-[background-color,color,box-shadow] duration-150 ease-power3-out focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        secondary: `bg-secondary text-secondary-foreground ${raised} hover:bg-muted data-[state=open]:bg-muted data-[active=true]:bg-muted`,
        primary:
          "bg-primary text-primary-foreground shadow-(--shadow-primary) hover:bg-(--primary-hover)",
        muted: `bg-muted text-foreground ${raised} hover:bg-(--muted-hover)`,
        outline: "bg-(--outline-bg) text-foreground shadow-[0px_0px_0px_1px_var(--outline-ring)] hover:bg-muted",
        ghost: "text-foreground hover:bg-(--overlay-hover) hover:text-foreground data-[state=open]:bg-(--overlay-hover)",
        subtle: "text-subtle hover:bg-(--overlay-hover) hover:text-foreground data-[state=open]:bg-(--overlay-hover)",
        danger:
          "bg-(--tag-red-bg) text-(--tag-red-text) shadow-[0px_0px_0px_1px_var(--tag-red-border)] hover:bg-(--danger-hover)",
        link: "rounded-none p-0 text-foreground underline decoration-from-font underline-offset-2 hover:text-soft",
      },
      size: {
        sm: "p-[9px] text-[12px] [&_svg:not([class*='size-'])]:size-3",
        md: "p-2 text-[14px] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 px-4 text-[14px] [&_svg:not([class*='size-'])]:size-3.5",
        icon: "size-[30px] p-0 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-6 p-0 [&_svg:not([class*='size-'])]:size-3",
        pill: "caption-style h-[30px] gap-1.5 py-[5px] pr-[7px] pl-[5px] font-normal",
        none: "",
      },
    },
    defaultVariants: { variant: "secondary", size: "sm" },
  },
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...(asChild ? {} : { type: props.type ?? "button" })}
      {...props}
    />
  )
}

export { Button, buttonVariants }
