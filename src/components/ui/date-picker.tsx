"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { formatDate, type Locale } from "@/lib/format"
import { Calendar as CalendarIcon, X } from "@/components/kit/icons"
import { Calendar } from "./calendar"
import { fieldBase } from "./input"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const DEFAULT_START_MONTH = new Date(2000, 0, 1)

/** `yyyy-MM-dd` → local Date (no UTC shift), or undefined. */
export function parseIsoDate(value: string | null | undefined): Date | undefined {
  if (!value || !ISO_DATE.test(value)) return undefined
  const [y, m, d] = value.split("-").map(Number)
  const date = new Date(y, m - 1, d)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : undefined
}

/** Local Date → `yyyy-MM-dd`. */
export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

/**
 * Date field: a trigger styled like our inputs that opens a Calendar in a Popover. Values are ISO
 * `yyyy-MM-dd` strings so callers keep their URL/query state unchanged. The trigger is a <button>, so a
 * wrapping <label> names it.
 */
function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder,
  clearable = false,
  disabled,
  className,
  id,
  "aria-label": ariaLabel,
  "data-testid": testId,
}: {
  value: string | null | undefined
  onChange: (value: string | null) => void
  /** Earliest selectable ISO date. */
  min?: string | null
  /** Latest selectable ISO date. */
  max?: string | null
  placeholder?: string
  clearable?: boolean
  disabled?: boolean
  className?: string
  id?: string
  "aria-label"?: string
  "data-testid"?: string
}) {
  const locale = useLocale() as Locale
  const t = useTranslations("datePicker")
  const [open, setOpen] = React.useState(false)
  const selected = parseIsoDate(value)
  const from = parseIsoDate(min)
  const to = parseIsoDate(max)
  // Open on the selection, else the latest allowed month (history ranges end at the last session).
  const defaultMonth = selected ?? to ?? undefined
  // Bounds of the month/year dropdowns when the caller gives none (market data starts well after 2000).
  const startMonth = from ?? DEFAULT_START_MONTH
  const endMonth = to ?? new Date()
  const label = selected ? formatDate(toIsoDate(selected), locale) : placeholder ?? t("placeholder")

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={cn("relative", className)}>
        <PopoverTrigger asChild>
          <button
            type="button"
            id={id}
            aria-label={ariaLabel}
            disabled={disabled}
            data-testid={testId}
            data-empty={selected ? undefined : true}
            className={cn(
              fieldBase,
              "num h-9 items-center gap-2 text-left text-[13px] data-[empty=true]:text-subtle data-[state=open]:border-ring",
              clearable && selected && "pr-8",
            )}
          >
            <CalendarIcon className="size-3.5 shrink-0 text-subtle" />
            <span className="min-w-0 flex-1 truncate">{label}</span>
          </button>
        </PopoverTrigger>
        {clearable && selected && !disabled && (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={t("clear")}
            className="absolute top-1/2 right-1.5 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-subtle transition-colors hover:bg-(--overlay-hover) hover:text-foreground"
          >
            <X className="size-3" />
          </button>
        )}
      </div>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          locale={locale}
          captionLayout="dropdown"
          selected={selected}
          defaultMonth={defaultMonth}
          startMonth={startMonth}
          endMonth={endMonth}
          disabled={[...(from ? [{ before: from }] : []), ...(to ? [{ after: to }] : [])]}
          onSelect={(date) => {
            onChange(date ? toIsoDate(date) : null)
            setOpen(false)
          }}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  )
}

export { DatePicker }
