"use client";

import { BarChart3, Table2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { Panel } from "@/components/layout/panel";
import { Button } from "@/components/ui/button";
import type { FreshnessMeta } from "@/lib/freshness";

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
    <Panel
      testId={testId}
      className={className}
      title={title}
      meta={meta}
      description={description}
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
    >
      <div className="min-w-0">{showTable && table ? table : children}</div>
      {footer && <div className="caption-style text-faint">{footer}</div>}
    </Panel>
  );
}
