"use client";

import { ArrowLeft } from "@/components/kit/icons";
import { parseAsString, useQueryState } from "nuqs";
import { useTranslations } from "next-intl";
import { DataState } from "@/components/feedback/data-state";
import { EmptyState } from "@/components/feedback/empty-state";
import { ResearchDisclaimer } from "@/components/feedback/research-disclaimer";
import { SectionHeader } from "@/components/layout/section-header";
import { ScreenerTable } from "@/components/data/screener-table";
import { WhyMatchedDrawer } from "@/components/market/why-matched-drawer";
import { Link } from "@/i18n/navigation";
import { useStrategies } from "@/lib/api/hooks";
import { freshnessMeta } from "@/lib/freshness";
import { candidatesFor } from "@/lib/strategies/contract";

export function StrategyDetailView({ id }: { id: string }) {
  const t = useTranslations();
  const query = useStrategies();
  // The open "why matched" panel is URL state (?why=SOCI): shareable, back-button friendly.
  const [why, setWhy] = useQueryState("why", parseAsString);
  return (
    <div className="flex flex-col gap-section p-4 md:p-6">
      <Link href="/discover/strategies" className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground pointer-coarse:min-h-10">
        <ArrowLeft className="size-3.5" />
        {t("strategies.back")}
      </Link>
      <DataState query={query}>
        {(envelope) => {
          const strategy = envelope.data.strategies.find((item) => item.id === id);
          if (!strategy) return <EmptyState title={t("strategies.notFound")} />;
          const meta = freshnessMeta(envelope);
          const candidates = candidatesFor(envelope.data, strategy.id);
          const selected = candidates.find((candidate) => candidate.symbol === why) ?? null;
          return (
            <>
              <SectionHeader as="h1" title={strategy.label} description={strategy.description ?? undefined} meta={meta} />
              <ResearchDisclaimer />
              <ScreenerTable candidates={candidates} meta={meta} caption={strategy.label} onWhy={(candidate) => void setWhy(candidate.symbol)} />
              <WhyMatchedDrawer candidate={selected} strategy={strategy} meta={meta} onClose={() => void setWhy(null)} />
            </>
          );
        }}
      </DataState>
    </div>
  );
}
