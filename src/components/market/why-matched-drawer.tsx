"use client";

import { HelpCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { FreshnessBadge } from "@/components/feedback/freshness-badge";
import { ResearchDisclaimer } from "@/components/feedback/research-disclaimer";
import { Drawer } from "@/components/layout/drawer";
import { stockHref } from "@/components/layout/nav-config";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { Strategy, StrategyMatch } from "@/lib/api/market";
import type { FreshnessMeta } from "@/lib/freshness";

/** WHY MATCHED: the observed criteria for one stock in one strategy, then a path to research it. */
export function WhyMatchedDrawer({ match, strategy, meta, onClose }: { match: StrategyMatch | null; strategy: Strategy; meta: FreshnessMeta; onClose: () => void }) {
  const t = useTranslations();
  return (
    <Drawer open={match !== null} onOpenChange={(open) => !open && onClose()} title={match ? t("strategies.whyTitle", { symbol: match.symbol }) : ""} description={match?.name}>
      {match && (
        <div className="flex flex-col gap-4" data-testid="why-matched">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm">{t("strategies.whyIntro", { symbol: match.symbol, strategy: strategy.name })}</p>
            <FreshnessBadge {...meta} />
          </div>
          <ul className="flex flex-col gap-2">
            {match.criteria.map((criterion, index) => (
              <li key={index} className="flex items-start gap-2 text-sm" data-criterion={criterion.kind === "recognized" ? criterion.key : "unrecognized"}>
                {criterion.kind === "recognized" ? (
                  <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-info" />
                ) : (
                  <HelpCircle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span>
                  {criterion.kind === "recognized" ? t(`criteria.${criterion.key}`) : `${t("criteria.unrecognized")}${criterion.providerLabel ? `: ${criterion.providerLabel}` : ""}`}
                </span>
              </li>
            ))}
          </ul>
          {match.providerNote && (
            <p className="text-xs text-muted-foreground">
              {t("strategy.providerNote")}: <span className="text-foreground">{match.providerNote}</span>
            </p>
          )}
          {strategy.description && (
            <div className="flex flex-col gap-1">
              <h3 className="text-xs font-medium text-muted-foreground">{t("strategies.about")}</h3>
              <p className="text-sm">{strategy.description}</p>
            </div>
          )}
          <ResearchDisclaimer />
          <Button asChild variant="primary" size="lg">
            <Link href={stockHref(match.symbol)} data-testid="why-research">{t("strategies.research", { symbol: match.symbol })}</Link>
          </Button>
        </div>
      )}
    </Drawer>
  );
}
