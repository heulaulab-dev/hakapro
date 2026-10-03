import { Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/** Short research-only notice, reused wherever strategies or derived observations appear. */
export function ResearchDisclaimer({ className }: { className?: string }) {
  const t = useTranslations("disclaimer");
  return (
    <aside aria-label={t("label")} data-testid="research-disclaimer" className={cn("flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground", className)}>
      <Info className="mt-0.5 size-3.5 shrink-0" />
      <p>{t("text")}</p>
    </aside>
  );
}
