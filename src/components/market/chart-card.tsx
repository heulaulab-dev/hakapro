"use client";

import { BarChart3, Table2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { SectionHeader } from "@/components/layout/section-header";
import { Button } from "@/components/ui/button";
import type { FreshnessMeta } from "@/lib/freshness";
import { cn } from "@/lib/utils";

/**
 * Frame for any chart: title, freshness, actions (e.g. range), the chart, and an equivalent table
 * view (so no value is only available as color or position).
 */
export function ChartCard({ title, description, meta, actions, table, footer, children, className, testId }: {
  title: ReactNode;
  description?: ReactNode;
  meta: FreshnessMeta;
  actions?: ReactNode;
  table?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  const t = useTranslations("table");
  const [showTable, setShowTable] = useState(false);
  return (
    <section data-testid={testId} className={cn("flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-4", className)}>
      <SectionHeader
        as="h3"
        title={title}
        description={description}
        meta={meta}
        actions={
          <>
            {actions}
            {table && (
              <Button variant="ghost" size="icon" onClick={() => setShowTable((value) => !value)} aria-pressed={showTable} aria-label={showTable ? t("showChart") : t("showTable")} title={showTable ? t("showChart") : t("showTable")}>
                {showTable ? <BarChart3 /> : <Table2 />}
              </Button>
            )}
          </>
        }
      />
      <div className="min-w-0">{showTable && table ? table : children}</div>
      {footer && <div className="text-[11px] text-muted-foreground">{footer}</div>}
    </section>
  );
}
