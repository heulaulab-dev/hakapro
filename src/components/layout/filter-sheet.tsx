"use client";

import { SlidersHorizontal } from "@/components/kit/icons";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTrigger } from "@/components/ui/sheet";

/**
 * Bottom-sheet container for filters on phones: the trigger stays in the thumb zone and the controls
 * get the full width and a larger touch size. `children` is a render function so the sheet can close
 * itself ("Show results") without the caller owning the open state.
 */
export function FilterSheet({ title, summary, activeCount, children, testId }: {
  title: ReactNode;
  /** What is applied right now, e.g. chips; shown next to the trigger. */
  summary?: ReactNode;
  activeCount?: number;
  children: (close: () => void) => ReactNode;
  testId?: string;
}) {
  const t = useTranslations("filters");
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <div className="flex min-w-0 items-center gap-2">
        <SheetTrigger asChild>
          <Button variant="outline" size="md" className="shrink-0" data-testid={testId}>
            <SlidersHorizontal />
            {t("open")}
            {activeCount ? <span className="num rounded-full bg-muted px-1.5 text-[11px]">{activeCount}</span> : null}
          </Button>
        </SheetTrigger>
        {summary}
      </div>
      <SheetContent side="bottom" className="max-h-[90dvh]" onOpenAutoFocus={(event) => event.preventDefault()}>
        <SheetHeader title={title} className="px-4" />
        <SheetBody className="flex flex-col gap-3 p-4">{children(() => setOpen(false))}</SheetBody>
        <SheetFooter className="h-auto min-h-[62px] px-4 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
          <Button variant="primary" size="lg" className="w-full" onClick={() => setOpen(false)}>{t("done")}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
