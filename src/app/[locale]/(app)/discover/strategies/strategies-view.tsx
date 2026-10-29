"use client";

import { ChevronRight } from "@/components/kit/icons";
import { useLocale, useTranslations } from "next-intl";
import { DataState } from "@/components/feedback/data-state";
import { ResearchDisclaimer } from "@/components/feedback/research-disclaimer";
import { SectionHeader } from "@/components/layout/section-header";
import { CriteriaList } from "@/components/data/screener-table";
import { InsightCard } from "@/components/market/insight-card";
import { screenContextObservations, screenContextVersion } from "@/components/market/screen-context";
import { Link } from "@/i18n/navigation";
import { useStrategies } from "@/lib/api/hooks";
import { freshnessMeta } from "@/lib/freshness";
import type { Locale } from "@/lib/format";
import { candidatesFor, criteriaOf } from "@/lib/strategies/contract";

export function StrategiesView() {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const query = useStrategies();
  return (
    <div className="flex flex-col gap-section p-4 md:p-6">
      <DataState query={query} isEmpty={(envelope) => envelope.data.strategies.length === 0}>
        {(envelope) => {
          const meta = freshnessMeta(envelope);
          const board = envelope.data;
          return (
            <>
              <SectionHeader as="h1" title={t("strategies.title")} description={t("strategies.intro")} meta={meta} />
              <ResearchDisclaimer />
              <InsightCard title={t("strategy.insightTitle")} description={screenContextVersion(board.contexts)} observations={screenContextObservations(board.contexts, t, locale)} meta={meta} />
              <ul className="flex flex-col gap-3" data-testid="strategy-list">
                {board.strategies.map((strategy) => {
                  const candidates = candidatesFor(board, strategy.id);
                  const reasons = candidates[0]?.reasons ?? [];
                  return (
                    <li key={strategy.id}>
                      <Link
                        href={`/discover/strategies/${strategy.id}`}
                        data-testid={`strategy-${strategy.id}`}
                        className="group flex flex-col gap-2 rounded-xl border border-border p-4 transition-colors hover:bg-accent/40"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-semibold">{strategy.label}</span>
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            {t("strategy.matches", { count: candidates.length })}
                            <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                          </span>
                        </div>
                        {strategy.description && <p className="text-sm text-muted-foreground">{strategy.description}</p>}
                        <div className="flex flex-wrap items-center gap-2">
                          {candidates.slice(0, 6).map((candidate) => (
                            <span key={candidate.symbol} className="ticker rounded-sm bg-muted px-1.5 py-0.5 text-xs">{candidate.symbol}</span>
                          ))}
                          {criteriaOf(reasons).length > 0 && <CriteriaList reasons={reasons} />}
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          );
        }}
      </DataState>
    </div>
  );
}
