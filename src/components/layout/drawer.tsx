"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTrigger } from "@/components/ui/sheet";

function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(true);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return desktop;
}

/** Details on demand: a right-side panel on desktop/tablet, a bottom sheet on mobile. */
export function Drawer({ open, onOpenChange, trigger, title, description, children }: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  const desktop = useIsDesktop();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {trigger && <SheetTrigger asChild>{trigger}</SheetTrigger>}
      <SheetContent
        side={desktop ? "right" : "bottom"}
        className={desktop ? "w-full sm:max-w-md" : "max-h-[85dvh]"}
        data-testid="drawer"
        // Focus the panel itself, not its first control: a focused badge would pop its tooltip.
        onOpenAutoFocus={(event) => { event.preventDefault(); (event.currentTarget as HTMLElement | null)?.focus(); }}
        tabIndex={-1}
      >
        <SheetHeader title={title} description={typeof description === "string" ? description : undefined} />
        <SheetBody className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {description && <p className="caption-style mb-4 text-subtle">{description}</p>}
          {children}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
