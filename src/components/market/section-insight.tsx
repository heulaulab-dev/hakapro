"use client";

import { AlertTriangle, Database } from "@/components/kit/icons";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/feedback/empty-state";
import { SectionHeader } from "@/components/layout/section-header";
import type { FreshnessMeta } from "@/lib/freshness";
import { InsightCard, type Observation } from "./insight-card";

type Section<T> = ({ status: "ok"; data: T } & FreshnessMeta) | { status: "error"; error: string };

const KNOWN = new Set(["NOT_RECORDED", "UNSUPPORTED", "NOT_CONFIGURED", "RATE_LIMITED", "PROVIDER_UNAVAILABLE", "MALFORMED_PROVIDER_RESPONSE", "INVALID_REQUEST"]);

/** InsightCard for one overview section; a failed section shows its reason, never placeholder numbers. */
export function SectionInsight<T>({ title, section, observations, testId }: { title: ReactNode; section: Section<T>; observations: (data: T) => Observation[]; testId?: string }) {
  const t = useTranslations("dataState");
  if (section.status === "error") {
    const reason = KNOWN.has(section.error) ? section.error : "default";
    return (
      <section data-testid={testId} data-status="error" className="flex flex-col gap-2 rounded-xl border border-border p-4">
        <SectionHeader as="h3" title={title} />
        <EmptyState compact icon={section.error === "NOT_RECORDED" || section.error === "UNSUPPORTED" ? <Database /> : <AlertTriangle />} title={t(`reasons.${reason}`)} description={<span className="ticker">{section.error}</span>} />
      </section>
    );
  }
  const { data, status: _status, ...meta } = section;
  return (
    <div data-testid={testId} data-status="ok">
      <InsightCard title={title} observations={observations(data)} meta={meta} className="h-full" />
    </div>
  );
}
