"use client";

import { AlertTriangle, Landmark, Radar as RadarIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { StockRow } from "@/components/data/stock-row";
import { DataState } from "@/components/feedback/data-state";
import { EmptyState } from "@/components/feedback/empty-state";
import { StatusBadge } from "@/components/feedback/status-badge";
import { Panel } from "@/components/layout/panel";
import { Link } from "@/i18n/navigation";
import { useRadar, useStealthOwnership } from "@/lib/api/hooks";
import { freshnessMeta } from "@/lib/freshness";
import { formatDate, formatVolume, type Locale } from "@/lib/format";
import { useRadarText } from "./radar-chips";

/** Integer share strings from the engine are exact; shown compact, never summed on the client. */
export function sharesText(value: string | null, locale: Locale, signed = false): string {
  if (value === null) return "—";
  return formatVolume(Number(value), locale, { compact: true, signed });
}

/** Plain statement shown before the first KSEI upload, with the upload link for admins. */
export function StealthNotUploaded({ canUpload, compact }: { canUpload: boolean; compact?: boolean }) {
  const t = useTranslations("stealth");
  return (
    <EmptyState compact={compact} icon={<Landmark />} title={<span data-testid="stealth-not-uploaded">{t("notUploaded")}</span>} description={t("notUploadedHint")}
      action={canUpload ? <Link href="/admin/ownership" className="caption-style text-link hover:underline" data-testid="stealth-upload-link">{t("uploadLink")}</Link> : undefined} />
  );
}

const viewAll = (href: string, label: string) => <Link href={href} className="caption-style text-link hover:underline">{label}</Link>;

/** Home-page preview: the top 8 radar stocks with their signal count and first signal; counter-evidence is flagged. */
export function RadarPreview({ limit = 8 }: { limit?: number }) {
  const t = useTranslations("radar");
  const query = useRadar();
  const text = useRadarText();
  return (
    <Panel title={t("previewTitle")} meta={query.data ? freshnessMeta(query.data) : undefined} testId="radar-preview" actions={viewAll("/discover/radar", t("viewAll"))}>
      <DataState query={query} compact>
        {({ data }) => !data.tradingDate ? <EmptyState compact icon={<RadarIcon />} title={t("noSession")} />
          : data.stocks.length === 0 ? <EmptyState compact icon={<RadarIcon />} title={t("noneFired")} /> : (
            <ol className="flex flex-col">
              {data.stocks.slice(0, limit).map((stock, index) => (
                <li key={stock.symbol} className="flex flex-col">
                  <StockRow symbol={stock.symbol} rank={index + 1} name={stock.fired[0] ? text.signal(stock.fired[0], data.rules) : stock.name} changePercent={stock.changePercent}
                    trailing={(
                      <span className="flex shrink-0 items-center gap-1">
                        {stock.counter.length > 0 && <AlertTriangle aria-label={t("counterLabel")} className="size-3.5 text-warning" />}
                        <StatusBadge tone="neutral">{t("firedCount", { count: stock.firedCount })}</StatusBadge>
                      </span>
                    )} />
                </li>
              ))}
            </ol>
          )}
      </DataState>
    </Panel>
  );
}

/** Home-page preview: the top 6 issuers of the KSEI corporate-holder view, or the plain "not uploaded" state. */
export function StealthPreview({ limit = 6, canUpload = false }: { limit?: number; canUpload?: boolean }) {
  const t = useTranslations("stealth");
  const locale = useLocale() as Locale;
  const query = useStealthOwnership();
  return (
    <Panel title={t("previewTitle")} meta={query.data ? freshnessMeta(query.data) : undefined} testId="stealth-preview" actions={viewAll("/discover/stealth", t("viewAll"))}>
      <DataState query={query} compact>
        {({ data }) => data.month === null ? <StealthNotUploaded canUpload={canUpload} compact />
          : data.stocks.length === 0 ? <EmptyState compact icon={<Landmark />} title={t("none", { month: formatDate(data.month, locale) })} /> : (
            <ul className="flex flex-col">
              {data.stocks.slice(0, limit).map((stock) => (
                <li key={stock.symbol}>
                  <StockRow symbol={stock.symbol} name={t("combined", { delta: sharesText(stock.combinedShareDelta, locale, true) })}
                    changePercent={stock.price ? stock.price.changePercent : null} />
                </li>
              ))}
            </ul>
          )}
      </DataState>
    </Panel>
  );
}
