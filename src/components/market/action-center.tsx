"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { stockHref } from "@/components/layout/nav-config";
import { ChangeValue } from "@/components/market/change-value";
import { Sheet, SheetContent, SheetHeader } from "@/components/ui/sheet";
import { Link } from "@/i18n/navigation";
import { useRadar } from "@/lib/api/hooks";
import type { RadarSignalKey } from "@/lib/radar/rules";

/** Short tag per radar signal, for the confluence cards. */
const SIGNAL_TAG: Record<RadarSignalKey, string> = {
  foreignNetBuy5: "ASING", foreignNetBuy20: "ASING", volumeSpike: "VOLUME",
  closeAboveAverage: "TREN", priceUp5: "NAIK", orderSizeSpike: "AOV", kseiHolderIncrease: "KSEI",
};

/**
 * Action Center (BDMFlow-style): a floating button showing how many stocks have a confluence of signals today, opening
 * a panel of those stocks ranked by how many documented radar signals fired. Research only — tags, never advice. Reads
 * the same radar snapshot the Signal Radar page uses (cached). Renders nothing until the radar has fired signals.
 */
export function ActionCenter() {
  const t = useTranslations("actionCenter");
  const [open, setOpen] = useState(false);
  const query = useRadar();
  const stocks = (query.data?.data.stocks ?? [])
    .filter((stock) => stock.firedCount > 0)
    .sort((a, b) => b.firedCount - a.firedCount || (b.changePercent ?? 0) - (a.changePercent ?? 0));
  if (stocks.length === 0) return null;
  const confluenceCount = stocks.filter((stock) => stock.firedCount >= 2).length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="action-center-button"
        className="fixed right-4 bottom-20 z-40 flex items-center gap-2 rounded-full border border-(--tag-neutral-border) bg-sidebar px-4 py-2 shadow-(--shadow-raised) outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/60 md:bottom-6"
      >
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-status opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-status" />
        </span>
        <span className="caption-style font-medium">{t("alerts", { count: confluenceCount })}</span>
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full max-w-sm overflow-y-auto">
          <SheetHeader title={t("title")} />
          <div className="flex flex-col gap-2 px-4 pb-6" data-testid="action-center">
            <p className="caption-style text-subtle">{t("note")}</p>
            {stocks.slice(0, 30).map((stock) => {
              const tags = [...new Set(stock.fired.map((signal) => SIGNAL_TAG[signal.key] ?? signal.key))];
              const tier = stock.firedCount >= 3 ? t("triple") : stock.firedCount === 2 ? t("double") : t("single");
              return (
                <Link
                  key={stock.symbol}
                  href={stockHref(stock.symbol)}
                  onClick={() => setOpen(false)}
                  data-testid={`alert-${stock.symbol}`}
                  className="flex flex-col gap-1.5 rounded-xl border border-border p-3 outline-none transition-colors hover:bg-(--overlay-soft) focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  <div className="flex items-center gap-2">
                    <span className="ticker font-semibold">{stock.symbol}</span>
                    <ChangeValue percent={stock.changePercent} className="text-xs" />
                    <span className="caption-style ml-auto text-faint">{tier}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {tags.map((tag) => <span key={tag} className="caption-style rounded bg-muted px-1.5 py-0.5 text-[10px] tracking-wide text-subtle">{tag}</span>)}
                  </div>
                </Link>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
