import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * Data table primitives in the reference look (same classes DataTable renders): hairline row rules,
 * caption-style headers, density-driven row height and cell padding, tabular numerals for numeric cells.
 * Wrap in a scroll container when the table can overflow.
 */
function Table({ className, ...props }: React.ComponentProps<"table">) {
  return <table data-slot="table" className={cn("w-full border-separate border-spacing-0 text-data", className)} {...props} />
}

function TableHeader({ className, sticky = false, ...props }: React.ComponentProps<"thead"> & { sticky?: boolean }) {
  return <thead data-slot="table-header" className={cn(sticky && "sticky top-0 z-10 bg-background", className)} {...props} />
}

function TableBody(props: React.ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" {...props} />
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return <tfoot data-slot="table-footer" className={cn("font-medium [&_td]:border-b-0 [&_td]:border-t [&_td]:border-line-strong", className)} {...props} />
}

/** Body rows highlight on hover; pass `interactive={false}` for header/static rows. */
function TableRow({ className, interactive = true, ...props }: React.ComponentProps<"tr"> & { interactive?: boolean }) {
  return (
    <tr
      data-slot="table-row"
      className={cn(interactive && "transition-colors duration-150 ease-power3-out hover:bg-(--overlay-soft)", className)}
      {...props}
    />
  )
}

function TableHead({ className, numeric = false, scope = "col", ...props }: React.ComponentProps<"th"> & { numeric?: boolean }) {
  return (
    <th
      data-slot="table-head"
      scope={scope}
      className={cn("caption-style h-[38px] border-b border-border px-3 font-normal whitespace-nowrap text-subtle", numeric ? "text-right" : "text-left", className)}
      {...props}
    />
  )
}

function TableCell({ className, numeric = false, ...props }: React.ComponentProps<"td"> & { numeric?: boolean }) {
  return (
    <td
      data-slot="table-cell"
      className={cn("border-b border-border px-3 py-cell-y align-middle", numeric && "ticker text-right whitespace-nowrap", className)}
      {...props}
    />
  )
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return <caption data-slot="table-caption" className={cn("caption-style mt-3 caption-bottom text-subtle", className)} {...props} />
}

export { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow }
