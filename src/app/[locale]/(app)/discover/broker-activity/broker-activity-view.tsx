"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { DataState } from "@/components/feedback/data-state";
import { BrokerActivityCharts } from "@/components/charts/lazy";
import { Panel } from "@/components/layout/panel";
import { SectionHeader } from "@/components/layout/section-header";
import { Segmented } from "@/components/kit/segmented";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMarketBrokerSummary } from "@/lib/api/hooks";
import { brokerActivityRange, BROKER_ACTIVITY_WINDOWS, deriveBrokerActivity, type BrokerActivityWindow } from "@/lib/broker-activity";
import { formatDate, formatIdr, type Locale } from "@/lib/format";

export function BrokerActivityView({ today }: { today: string }) {
  const t = useTranslations("brokerActivity");
  const locale = useLocale() as Locale;
  const [window, setWindow] = useState<BrokerActivityWindow>("3M");
  const range = useMemo(() => brokerActivityRange(window, today), [today, window]);
  const query = useMarketBrokerSummary({ ...range, limit: 100 });

  return <div className="flex flex-col gap-section p-4 md:p-6" data-testid="broker-activity-view">
    <SectionHeader as="h1" title={t("title")} description={t("intro")} />
    <DataState query={query} isEmpty={(envelope) => envelope.data.dates.length === 0}>
      {(envelope) => {
        const model = deriveBrokerActivity(envelope.data);
        const meta = { freshness: envelope.freshness, asOf: envelope.asOf, source: envelope.source };
        return <>
          <div className="grid gap-3 sm:grid-cols-3" data-testid="broker-activity-metrics">
            <Panel title={t("sessionCoverage")}><p className="text-2xl font-semibold" data-testid="broker-session-coverage">{model.coverageKnown ? `${model.reportedSessions} / ${model.expectedDates.length}` : "—"}</p><p className="caption-style text-subtle">{model.coverageKnown ? t("sessionCoverageHint") : t("coverageUnknown")}</p></Panel>
            <Panel title={t("topFiveShare")}><p className="text-2xl font-semibold" data-testid="broker-top-five-share">{model.latestTopFiveSharePercent === null ? "—" : `${model.latestTopFiveSharePercent.toFixed(2)}%`}</p><p className="caption-style text-subtle">{t("latestSession", { date: model.latestDate ? formatDate(model.latestDate, locale) : "—" })}</p></Panel>
            <Panel title={t("hhi")}><p className="text-2xl font-semibold" data-testid="broker-hhi">{model.latestHhi === null ? "—" : Math.round(model.latestHhi).toLocaleString(locale === "id" ? "id-ID" : "en-US")}</p><p className="caption-style text-subtle">{model.latestConcentrationComplete ? t("hhiHint") : t("concentrationUnavailableShort")}</p></Panel>
          </div>

          <Panel title={t("historyTitle")} description={t("historyIntro")} meta={meta} testId="broker-activity-history" actions={<div data-testid="broker-activity-window"><Segmented value={window} onChange={(value) => setWindow(value as BrokerActivityWindow)} options={BROKER_ACTIVITY_WINDOWS.map((value) => ({ value, label: value }))} /></div>}>
            {model.coverageKnown && <p className="mb-3 caption-style text-subtle" data-testid="broker-activity-coverage">
              {t("coverage", { reported: model.reportedSessions ?? 0, expected: model.expectedDates.length })}
              {model.missingDates.length > 0 && <> · {t("missingSessions", { count: model.missingDates.length })}</>}
            </p>}
            <BrokerActivityCharts data={model} />
            <p className="mt-3 caption-style leading-relaxed text-subtle" data-testid="broker-activity-methodology">{t("methodology")}</p>
          </Panel>

          <Panel title={t("tableTitle")} description={t("tableHint")} meta={meta}>
            <div className="overflow-x-auto" data-testid="broker-activity-table-wrap">
              <Table className="min-w-[38rem] text-xs" data-testid="broker-activity-table">
                <TableHeader><TableRow interactive={false}><TableHead>{t("code")}</TableHead><TableHead>{t("firm")}</TableHead><TableHead numeric>{t("reportedValue")}</TableHead><TableHead numeric>{t("reportedShare")}</TableHead><TableHead numeric>{t("volume")}</TableHead><TableHead numeric>{t("frequency")}</TableHead></TableRow></TableHeader>
                <TableBody>{model.rows.slice(0, 20).map((row) => <TableRow key={row.code} data-testid={`broker-activity-row-${row.code}`}>
                  <TableCell className="ticker font-medium">{row.code}</TableCell><TableCell>{row.name ?? "—"}</TableCell><TableCell numeric className="num">{formatIdr(row.value, locale, { compact: true })}</TableCell><TableCell numeric className="num">{row.sharePercent === null ? "—" : `${row.sharePercent.toFixed(2)}%`}</TableCell><TableCell numeric className="num">{row.volume === null ? "—" : Math.round(row.volume).toLocaleString(locale === "id" ? "id-ID" : "en-US")}</TableCell><TableCell numeric className="num">{row.frequency === null ? "—" : Math.round(row.frequency).toLocaleString(locale === "id" ? "id-ID" : "en-US")}</TableCell>
                </TableRow>)}</TableBody>
              </Table>
            </div>
            {!model.coverageKnown && <p className="mt-3 caption-style text-subtle">{t("coverageUnknown")}</p>}
          </Panel>
        </>;
      }}
    </DataState>
  </div>;
}
