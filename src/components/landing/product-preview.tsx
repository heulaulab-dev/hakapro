import { getLocale, getTranslations } from "next-intl/server";
import { FreshnessBadge } from "@/components/feedback/freshness-badge";
import { StatusBadge } from "@/components/feedback/status-badge";
import { Meter } from "@/components/kit/meter";
import { formatChange, formatIdr, formatPercent, type Locale } from "@/lib/format";

// Fixed, clearly labelled illustration values; nothing here is market data.
const FLOW = [12, -6, 18, 9, -14, 22, 5, -3, 16, 11, -9, 7, 19, -12, 8, 14, -5, 10, 21, 6];
const BUYERS = [["AA", 0.92], ["BB", 0.71], ["CC", 0.48]] as const;

/** A stylized stock page that shows the product's shape (freshness, flow, analysis) without real data. */
export async function ProductPreview() {
  const t = await getTranslations("landing.preview");
  const locale = (await getLocale()) as Locale;
  const tabs = t.raw("tabs") as string[];
  const max = Math.max(...FLOW.map(Math.abs));
  return (
    <figure aria-label={t("label")} className="relative w-full overflow-hidden rounded-2xl border border-line-strong bg-card shadow-(--shadow-overlay)" data-testid="landing-preview">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="ticker text-lg font-semibold">ABCD</span>
          <span className="caption-style truncate text-soft">{t("company")}</span>
        </div>
        <span className="caption-style rounded-full border border-dashed border-line-strong px-2 py-1 text-subtle">{t("badge")}</span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pt-4">
        <span className="ticker text-2xl font-semibold">{formatIdr(4250, locale)}</span>
        <span className="ticker text-sm text-positive">{formatChange(75, locale)} ({formatPercent(1.8, locale)})</span>
        <FreshnessBadge freshness="DELAYED" asOf={null} />
      </div>
      <div className="no-scrollbar flex gap-4 overflow-x-hidden border-b border-border px-4 pt-3 text-xs text-subtle">
        {tabs.map((tab, index) => <span key={tab} className={index === 1 ? "border-b-2 border-primary pb-2 text-foreground" : "pb-2"}>{tab}</span>)}
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="caption-style text-soft">{t("flow")}</span>
            <FreshnessBadge freshness="EOD" asOf={null} />
          </div>
          <svg viewBox="0 0 200 64" preserveAspectRatio="none" className="min-h-20 w-full flex-1" aria-hidden>
            <line x1="0" x2="200" y1="32" y2="32" className="stroke-border" strokeWidth="0.5" />
            {FLOW.map((value, index) => {
              const height = (Math.abs(value) / max) * 28;
              return <rect key={index} x={index * 10 + 2} width="6" rx="1" y={value >= 0 ? 32 - height : 32} height={height} className={value >= 0 ? "fill-positive" : "fill-negative"} />;
            })}
          </svg>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
            <span className="caption-style text-soft">{t("brokers")}</span>
            {BUYERS.map(([code, share]) => (
              <div key={code} className="flex items-center gap-2">
                <span className="ticker w-6 text-xs">{code}</span>
                <span className="h-1.5 rounded-full bg-positive/70" style={{ width: `${share * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
            <span className="caption-style text-soft">{t("score")}</span>
            <div className="flex items-baseline gap-2">
              <span className="ticker text-xl font-semibold">45</span>
              <span className="text-xs text-subtle">{t("of")}</span>
              <StatusBadge tone="warning">{t("tone")}</StatusBadge>
            </div>
            <Meter value={60} />
          </div>
        </div>
      </div>
    </figure>
  );
}
