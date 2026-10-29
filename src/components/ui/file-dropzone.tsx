"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { formatBytes, type Locale } from "@/lib/format"
import { FileText, Upload, X } from "@/components/kit/icons"

/**
 * Drop target + file chooser. Keeps a real (visually hidden) <input type="file"> so forms, `required`,
 * labels and automation (setInputFiles) behave exactly like the native control.
 */
function FileDropzone({
  id,
  accept,
  required,
  disabled,
  file,
  onFileChange,
  hint,
  className,
  "data-testid": testId,
}: {
  id?: string
  accept?: string
  required?: boolean
  disabled?: boolean
  file: File | null
  onFileChange: (file: File | null) => void
  hint?: React.ReactNode
  className?: string
  "data-testid"?: string
}) {
  const locale = useLocale() as Locale
  const t = useTranslations("fileDropzone")
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = React.useState(false)

  const pick = (next: File | null) => onFileChange(next)

  // A parent reset (file → null, e.g. after a successful upload) must also empty the real input.
  React.useEffect(() => {
    if (!file && inputRef.current) inputRef.current.value = ""
  }, [file])

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label
        htmlFor={id}
        data-dragging={dragging || undefined}
        data-filled={file ? true : undefined}
        aria-disabled={disabled || undefined}
        onDragOver={(event) => { event.preventDefault(); if (!disabled) setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          if (disabled) return
          const dropped = event.dataTransfer.files?.[0]
          if (!dropped) return
          // Mirror the drop into the real input so `required` validation and form data see it.
          if (inputRef.current) {
            const transfer = new DataTransfer()
            transfer.items.add(dropped)
            inputRef.current.files = transfer.files
          }
          pick(dropped)
        }}
        className={cn(
          "group/drop relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong bg-(--overlay-soft) px-4 py-6 text-center transition-[border-color,background-color,box-shadow] duration-200 ease-power3-out",
          "hover:border-ring hover:bg-(--overlay-hover) focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/40",
          "data-[dragging=true]:border-primary data-[dragging=true]:bg-primary/10 data-[dragging=true]:shadow-[0_0_0_4px_color-mix(in_oklab,var(--primary)_18%,transparent)]",
          "data-[filled=true]:border-solid data-[filled=true]:py-3",
          "aria-disabled:pointer-events-none aria-disabled:opacity-50",
        )}
      >
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={accept}
          required={required}
          disabled={disabled}
          data-testid={testId}
          onChange={(event) => pick(event.target.files?.[0] ?? null)}
          className="sr-only"
        />
        {file ? (
          <span className="flex w-full items-center gap-3 text-left">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-soft shadow-(--shadow-raised)">
              <FileText className="size-4" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate text-[13px] font-medium text-foreground">{file.name}</span>
              <span className="num caption-style text-subtle">{formatBytes(file.size, locale)}</span>
            </span>
            <button
              type="button"
              onClick={(event) => { event.preventDefault(); pick(null) }}
              aria-label={t("remove")}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-subtle transition-colors hover:bg-(--overlay-hover) hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </span>
        ) : (
          <>
            <span className="inline-flex size-10 items-center justify-center rounded-full bg-secondary text-soft shadow-(--shadow-raised) transition-transform duration-200 ease-power3-out group-hover/drop:-translate-y-0.5 group-data-[dragging=true]/drop:scale-110">
              <Upload className="size-4" />
            </span>
            <span className="text-[13px] text-foreground">
              <span className="font-medium text-(--tag-blue-text)">{t("choose")}</span> {t("orDrop")}
            </span>
            {hint && <span className="caption-style text-subtle">{hint}</span>}
          </>
        )}
      </label>
    </div>
  )
}

export { FileDropzone }
