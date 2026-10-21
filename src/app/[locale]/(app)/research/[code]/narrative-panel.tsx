"use client";

import { Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Panel } from "@/components/layout/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { useResearchNarrative } from "@/lib/api/ai";
import { formatDate, type Locale } from "@/lib/format";

/**
 * Optional AI summary of the brief (spec §3.8). Rendered only when the server reports AI on; it disappears on
 * any error or rejected (unverified) text, leaving the structured brief as the page.
 */
export function NarrativePanel({ code }: { code: string }) {
  const t = useTranslations("research.narrative");
  const locale = useLocale() as Locale;
  const query = useResearchNarrative(code, locale, true);
  if (query.isError) return null;
  if (query.data && (query.data.status !== "ok" || !query.data.sentences?.length)) return null;
  return (
    <Panel title={t("title")} testId="research-narrative" actions={<Sparkles className="size-4 text-icon" aria-hidden />}
      description={t("label")}>
      {query.data?.sentences ? (
        <>
          <p className="text-sm leading-relaxed" data-testid="research-narrative-text" lang={query.data.lang}>{query.data.sentences.join(" ")}</p>
          <p className="caption-style num text-subtle">{t("basis", { date: formatDate(query.data.asOf, locale) })}</p>
        </>
      ) : (
        <div className="flex flex-col gap-2" aria-label={t("loading")}>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      )}
    </Panel>
  );
}
