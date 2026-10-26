"use client";

import { Landmark } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { DataState } from "@/components/feedback/data-state";
import { EmptyState } from "@/components/feedback/empty-state";
import { ResearchDisclaimer } from "@/components/feedback/research-disclaimer";
import { StatusBadge } from "@/components/feedback/status-badge";
import { stockHref } from "@/components/layout/nav-config";
import { SectionHeader } from "@/components/layout/section-header";
import { ChangeValue } from "@/components/market/change-value";
import { sharesText, StealthNotUploaded } from "@/components/radar/previews";
import { Link } from "@/i18n/navigation";
import { useStealthOwnership } from "@/lib/api/hooks";
import type { StealthOwnership, StealthStock } from "@/lib/api/market";
import { freshnessMeta } from "@/lib/freshness";
import { formatDate, formatIdr, formatPercent, type Locale } from "@/lib/format";

const pctText = (value: string | null, locale: Locale) => (value === null ? "—" : formatPercent(Number(value), locale, { signed: false }));

/**
 * KSEI view: in the newest uploaded month, issuers whose corporate (CP) ≥1% holders raised their combined shares while
 * the close was flat or lower between the two position dates. A description of two data sets, not a conclusion.
 */
export function StealthView({ canUpload = false }: { canUpload?: boolean }) {
  const t = useTranslations("stealth");
  const query = useStealthOwnership();
  return (
    <div className="flex flex-col gap-section p-4 md:p-6" data-testid="stealth-view">
      <SectionHeader as="h1" title={t("title")} description={t("intro")} meta={query.data ? freshnessMeta(query.data) : undefined}
        actions={<Link href="/methodology" className="caption-style text-link hover:underline">{t("methodologyLink")}</Link>} />
      <DataState query={query}>
        {(envelope) => envelope.data.month === null ? <StealthNotUploaded canUpload={canUpload} /> : <StealthBody data={envelope.data} />}
      </DataState>
      <ResearchDisclaimer />
    </div>
  );
}

function StealthBody({ data }: { data: StealthOwnership }) {
  const t = useTranslations("stealth");
  const locale = useLocale() as Locale;
  const { coverage } = data;
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm" data-testid="stealth-info">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="num font-medium">{t("months", { month: formatDate(data.month, locale), previous: formatDate(data.previousMonth, locale) })}</span>
          <span className="caption-style ticker text-subtle" data-testid="stealth-rules-version">{t("rulesVersion", { version: data.rulesVersion })}</span>
        </div>
        <p className="caption-style text-subtle" data-testid="stealth-coverage">
          {t("coverage", {
            corporate: coverage.corporateIncrease, issuers: coverage.issuers, rose: coverage.priceRose, missing: coverage.priceMissing,
            types: data.rules.investorTypes.join(", "), max: formatPercent(data.rules.maxPriceChange * 100, locale, { decimals: 1 }),
          })}
        </p>
      </div>
      {data.stocks.length === 0 ? <EmptyState compact icon={<Landmark />} title={t("none", { month: formatDate(data.month, locale) })} /> : (
        <ul className="flex flex-col gap-3" data-testid="stealth-list">
          {data.stocks.map((stock) => <StealthItem key={stock.symbol} stock={stock} />)}
        </ul>
      )}
    </section>
  );
}

function StealthItem({ stock }: { stock: StealthStock }) {
  const t = useTranslations("stealth");
  const locale = useLocale() as Locale;
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-border p-3" data-testid={`stealth-row-${stock.symbol}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link href={stockHref(stock.symbol, "ownership")} className="ticker font-medium text-link hover:underline">{stock.symbol}</Link>
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{stock.name}</span>
        <span className="caption-style num text-subtle">{t("period", { from: formatDate(stock.fromDate, locale), to: formatDate(stock.toDate, locale) })}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span data-testid="stealth-combined">{t("combined", { delta: sharesText(stock.combinedShareDelta, locale, true) })}</span>
        {stock.newHolders > 0 && <span className="caption-style text-subtle">{t("newHolders", { count: stock.newHolders })}</span>}
        {stock.price ? (
          <span className="inline-flex items-center gap-1.5" data-testid="stealth-price">
            {t("price", { from: formatIdr(stock.price.from.close, locale), to: formatIdr(stock.price.to.close, locale) })}
            <ChangeValue percent={stock.price.changePercent} />
          </span>
        ) : <span className="caption-style text-subtle" data-testid="stealth-price-missing">{t("priceMissing")}</span>}
      </div>
      <ul className="flex flex-col divide-y divide-border text-sm">
        {stock.holders.map((holder) => (
          <li key={holder.holderKey} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
            <span className="min-w-0 flex-1 truncate">{holder.holderName}</span>
            <StatusBadge tone={holder.kind === "DECREASE" || holder.kind === "BELOW_THRESHOLD" || holder.kind === "EXIT" ? "warning" : "neutral"}>{t(`kind.${holder.kind}` as "kind.INCREASE")}</StatusBadge>
            <span className="num shrink-0 text-xs">
              {pctText(holder.percentBefore, locale)} → {pctText(holder.percentAfter, locale)}
              {holder.shareDelta !== null && <span className="text-muted-foreground"> ({sharesText(holder.shareDelta, locale, true)})</span>}
            </span>
            {holder.flags.includes("ISSUED_SHARES_CHANGED") && <StatusBadge tone="warning">{t("issuedSharesChanged")}</StatusBadge>}
          </li>
        ))}
      </ul>
    </li>
  );
}
