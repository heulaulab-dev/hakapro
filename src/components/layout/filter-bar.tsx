"use client";

import { Search, X } from "lucide-react";
import { parseAsString, useQueryState } from "nuqs";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/** One row of filters above a list or chart. Filter values live in the URL via nuqs. */
export function FilterBar({ children, onReset, active }: { children: ReactNode; onReset?: () => void; active?: boolean }) {
  const t = useTranslations("filters");
  return (
    <div role="group" aria-label={t("label")} className="flex flex-wrap items-center gap-2">
      {children}
      {onReset && active && (
        <Button variant="ghost" size="sm" onClick={onReset} data-testid="filter-reset">
          <X />
          {t("reset")}
        </Button>
      )}
    </div>
  );
}

/** Text filter bound to a URL param (default `q`). */
export function FilterSearch({ param = "q", placeholder }: { param?: string; placeholder?: string }) {
  const t = useTranslations("filters");
  const [value, setValue] = useQueryState(param, parseAsString.withDefault("").withOptions({ throttleMs: 250 }));
  return (
    <div className="relative w-full max-w-xs">
      <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input value={value} onChange={(event) => void setValue(event.target.value || null)} placeholder={placeholder ?? t("search")} className="h-8 pl-7 text-sm" data-testid={`filter-${param}`} />
    </div>
  );
}

/** Single-choice chips bound to a URL param. */
export function FilterChips<T extends string>({ param, options, label }: { param: string; options: Array<{ value: T; label: ReactNode }>; label: string }) {
  const [value, setValue] = useQueryState(param, parseAsString);
  return (
    <ToggleGroup type="single" size="sm" variant="outline" value={value ?? ""} onValueChange={(next) => void setValue(next || null)} aria-label={label}>
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value} className="px-2.5 text-xs" data-testid={`chip-${param}-${option.value}`}>
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
