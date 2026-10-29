"use client"

import * as React from "react"
import { DayPicker, getDefaultClassNames, type DayPickerProps, type DropdownProps } from "react-day-picker"
import { enUS, id } from "react-day-picker/locale"
import { cn } from "@/lib/utils"
import type { Locale } from "@/lib/format"
import { ChevronDown, ChevronLeft, ChevronRight } from "@/components/kit/icons"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select"

const DAY_PICKER_LOCALES = { id, en: enUS } as const

/** Omit that keeps DayPicker's `mode` union intact (plain Omit collapses it). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/**
 * Month/year switcher in our Select instead of DayPicker's native <select>. DayPicker listens for a change
 * event, so the chosen value is handed back in that shape.
 */
function CalendarDropdown({ options, value, onChange, disabled, "aria-label": ariaLabel }: DropdownProps) {
  return (
    <Select
      value={value === undefined ? undefined : String(value)}
      disabled={disabled}
      onValueChange={(next) => onChange?.({ target: { value: next } } as React.ChangeEvent<HTMLSelectElement>)}
    >
      <SelectTrigger aria-label={ariaLabel} className="h-7 gap-1 rounded-md border-transparent bg-transparent px-2 text-[13px] font-medium hover:bg-(--overlay-hover) [&>svg]:size-3">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-64">
        {options?.map((option) => (
          <SelectItem key={option.value} value={String(option.value)} disabled={option.disabled}>{option.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function Calendar({
  className,
  classNames,
  locale = "en",
  showOutsideDays = true,
  captionLayout = "label",
  ...props
}: DistributiveOmit<DayPickerProps, "locale"> & { locale?: Locale }) {
  const defaults = getDefaultClassNames()
  return (
    <DayPicker
      locale={DAY_PICKER_LOCALES[locale]}
      showOutsideDays={showOutsideDays}
      captionLayout={captionLayout}
      className={cn("p-3 [--cell:2.25rem] pointer-coarse:[--cell:2.75rem]", className)}
      classNames={{
        root: cn("w-fit", defaults.root),
        months: cn("relative flex flex-col gap-4 sm:flex-row", defaults.months),
        month: cn("flex w-full flex-col gap-3", defaults.month),
        nav: cn("absolute inset-x-0 top-0 flex items-center justify-between", defaults.nav),
        button_previous: cn(navButton, defaults.button_previous),
        button_next: cn(navButton, defaults.button_next),
        month_caption: cn("flex h-(--cell) items-center justify-center px-(--cell)", defaults.month_caption),
        dropdowns: cn("flex items-center gap-0.5", defaults.dropdowns),
        caption_label: cn("text-[13px] font-medium select-none", captionLayout !== "label" && "hidden", defaults.caption_label),
        month_grid: "w-full border-collapse",
        weekdays: cn("flex", defaults.weekdays),
        weekday: cn("w-(--cell) text-center text-[11px] font-normal uppercase text-subtle select-none", defaults.weekday),
        week: cn("mt-1 flex w-full", defaults.week),
        day: cn("group/day relative size-(--cell) p-0 text-center select-none", defaults.day),
        day_button: cn(
          "num inline-flex size-full items-center justify-center rounded-lg text-[13px] text-foreground outline-none transition-[background-color,color,box-shadow] duration-150 ease-power3-out",
          "hover:bg-(--overlay-hover) focus-visible:ring-2 focus-visible:ring-ring/60",
          "group-data-[selected=true]/day:bg-primary group-data-[selected=true]/day:text-primary-foreground group-data-[selected=true]/day:shadow-(--shadow-primary)",
          defaults.day_button,
        ),
        today: cn("[&>button]:font-semibold [&>button]:text-(--tag-blue-text) data-[selected=true]:[&>button]:text-primary-foreground", defaults.today),
        outside: cn("[&>button]:text-faint", defaults.outside),
        disabled: cn("[&>button]:pointer-events-none [&>button]:text-faint [&>button]:line-through [&>button]:decoration-faint/60", defaults.disabled),
        hidden: cn("invisible", defaults.hidden),
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: chevronClassName }) => {
          const Icon = orientation === "left" ? ChevronLeft : orientation === "right" ? ChevronRight : ChevronDown
          return <Icon className={cn("size-3.5", chevronClassName)} />
        },
        Dropdown: CalendarDropdown,
      }}
      {...(props as DayPickerProps)}
    />
  )
}

const navButton =
  "relative z-10 inline-flex size-(--cell) items-center justify-center rounded-lg text-soft outline-none transition-colors duration-150 ease-power3-out hover:bg-(--overlay-hover) hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 aria-disabled:pointer-events-none aria-disabled:opacity-40"

export { Calendar }
