"use client";

import { HelpCircle } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { FreshnessBadge } from "@/components/feedback/freshness-badge";
import { StatusBadge } from "@/components/feedback/status-badge";
import { ResearchDisclaimer } from "@/components/feedback/research-disclaimer";
import { Drawer } from "@/components/layout/drawer";
import { stockHref } from "@/components/layout/nav-config";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/lib/format";
import type { FreshnessMeta } from "@/lib/freshness";
import { criteriaOf, formatMetric, textsOf, type ScreenerCandidate, type ScreenerStrategy } from "@/lib/strategies/contract";

/** WHY MATCHED: the observed criteria for one stock in one strategy, then a path to research it. */
export function WhyMatchedDrawer({ candidate, strategy, meta, onClose }: { candidate: ScreenerCandidate | null; strategy: ScreenerStrategy; meta: FreshnessMeta; onClose: () => void }) {
  const t = useTranslations();
  const tMetrics = useTranslations("metrics");
  const locale = useLocale() as Locale;
  const patterns = candidate ? textsOf(candidate.reasons, "pattern") : [];
  const notes = candidate ? textsOf(candidate.reasons, "note") : [];
  return (
    <Drawer open={candidate !== null} onOpenChange={(open) => !open && onClose()} title={candidate ? t("strategies.whyTitle", { symbol: candidate.symbol }) : ""} description={candidate?.name ?? undefined}>
      {candidate && (
        <div className="flex flex-col gap-4" data-testid="why-matched">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm">{t("strategies.whyIntro", { symbol: candidate.symbol, strategy: strategy.label })}</p>
            <FreshnessBadge {...meta} />
          </div>
          <ul className="flex flex-col gap-2">
            {criteriaOf(candidate.reasons).map((reason, index) => (
              <li key={index} className="flex items-start gap-2 text-sm" data-criterion={reason.kind === "criterion" ? reason.key : "unrecognized"}>
                {reason.kind === "criterion" ? (
                  <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-info" />
                ) : (
                  <HelpCircle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span>
                  {reason.kind === "criterion" ? t(`criteria.${reason.key}`) : `${t("criteria.unrecognized")}${reason.label ? `: ${reason.label}` : ""}`}
                </span>
              </li>
            ))}
          </ul>
          {/* Only engines that measure something send metrics; a missing value reads "—", never 0. */}
          {candidate.metrics.length > 0 && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm" data-testid="why-metrics">
              {candidate.metrics.map((metric) => (
                <div key={metric.key} className="contents" data-metric={metric.key} data-available={metric.value !== null}>
                  <dt className="text-muted-foreground">{tMetrics.has(metric.key) ? tMetrics(metric.key) : metric.key}</dt>
                  <dd className="num text-right">{formatMetric(metric, locale)}</dd>
                </div>
              ))}
            </dl>
          )}
          {(patterns.length > 0 || notes.length > 0) && (
            <div className="flex flex-col gap-2" data-testid="why-notes">
              <h3 className="eyebrow-style text-subtle">{t("strategy.providerNote")}</h3>
              {patterns.map((pattern) => <p key={pattern} className="p-style">{t("strategy.pattern")}: {pattern}</p>)}
              <span className="flex flex-wrap gap-1">{notes.map((note) => <StatusBadge key={note} tone="neutral">{note}</StatusBadge>)}</span>
            </div>
          )}
          {strategy.description && (
            <div className="flex flex-col gap-1">
              <h3 className="text-xs font-medium text-muted-foreground">{t("strategies.about")}</h3>
              <p className="text-sm">{strategy.description}</p>
            </div>
          )}
          <ResearchDisclaimer />
          <Button asChild variant="primary" size="lg">
            <Link href={stockHref(candidate.symbol)} data-testid="why-research">{t("strategies.research", { symbol: candidate.symbol })}</Link>
          </Button>
        </div>
      )}
    </Drawer>
  );
}
