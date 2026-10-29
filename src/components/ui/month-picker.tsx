"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { formatMonthName, type Locale } from "@/lib/format"
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "@/components/kit/icons"
import { fieldBase } from "./input"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"

const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

const key = (year: number, month: number) => `${year}-${String(month + 1).padStart(2, "0")}`

/** Month field (`yyyy-MM`): a year stepper over a 12-month grid, replacing the browser's <input type="month">. */
function MonthPicker({
  value,
  onChange,
  min,
  max,
  disabled,
  className,
  id,
  "aria-label": ariaLabel,
  "data-testid": testId,
}: {
  value: string | null | undefined
  onChange: (value: string) => void
  /** Earliest selectable `yyyy-MM`. */
  min?: string
  /** Latest selectable `yyyy-MM`. */
  max?: string
  disabled?: boolean
  className?: string
  id?: string
  "aria-label"?: string
  "data-testid"?: string
}) {
  const locale = useLocale() as Locale
  const t = useTranslations("datePicker")
  const [open, setOpen] = React.useState(false)
  const selected = value && ISO_MONTH.test(value) ? value : null
  const [year, setYear] = React.useState(() => Number((selected ?? max ?? key(new Date().getFullYear(), new Date().getMonth())).slice(0, 4)))
  const monthNames = React.useMemo(() => Array.from({ length: 12 }, (_, month) => formatMonthName(month + 1, locale)), [locale])
  const label = selected ? `${formatMonthName(Number(selected.slice(5, 7)), locale)} ${selected.slice(0, 4)}` : t("placeholderMonth")
  const outOfRange = (candidate: string) => (min !== undefined && candidate < min) || (max !== undefined && candidate > max)
  const minYear = min ? Number(min.slice(0, 4)) : -Infinity
  const maxYear = max ? Number(max.slice(0, 4)) : Infinity

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (next && selected) setYear(Number(selected.slice(0, 4))) }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          aria-label={ariaLabel}
          disabled={disabled}
          data-testid={testId}
          data-value={selected ?? undefined}
          className={cn(fieldBase, "h-9 items-center gap-2 text-left text-[13px] data-[state=open]:border-ring", !selected && "text-subtle", className)}
        >
          <CalendarIcon className="size-3.5 shrink-0 text-subtle" />
          <span className="min-w-0 flex-1 truncate capitalize">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <div className="mb-2 flex items-center justify-between">
          <button type="button" onClick={() => setYear(year - 1)} disabled={year - 1 < minYear} aria-label={t("previousYear")} className={stepper}>
            <ChevronLeft className="size-3.5" />
          </button>
          <span className="num text-[13px] font-medium">{year}</span>
          <button type="button" onClick={() => setYear(year + 1)} disabled={year + 1 > maxYear} aria-label={t("nextYear")} className={stepper}>
            <ChevronRight className="size-3.5" />
          </button>
        </div>
        <div role="grid" className="grid grid-cols-3 gap-1">
          {monthNames.map((name, month) => {
            const candidate = key(year, month)
            const isSelected = candidate === selected
            return (
              <button
                key={candidate}
                type="button"
                role="gridcell"
                aria-selected={isSelected}
                data-month={candidate}
                disabled={outOfRange(candidate)}
                onClick={() => { onChange(candidate); setOpen(false) }}
                className={cn(
                  "h-9 rounded-lg text-[13px] capitalize text-foreground outline-none transition-[background-color,color,box-shadow] duration-150 ease-power3-out hover:bg-(--overlay-hover) focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:text-faint",
                  isSelected && "bg-primary text-primary-foreground shadow-(--shadow-primary) hover:bg-(--primary-hover)",
                )}
              >
                {name}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

const stepper =
  "inline-flex size-8 items-center justify-center rounded-lg text-soft outline-none transition-colors duration-150 ease-power3-out hover:bg-(--overlay-hover) hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-40"

export { MonthPicker }
