"use client";

import { ExternalLink, Network } from "@/components/kit/icons";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useLocale, useTranslations } from "next-intl";
import { DataState } from "@/components/feedback/data-state";
import { EmptyState } from "@/components/feedback/empty-state";
import { ResearchDisclaimer } from "@/components/feedback/research-disclaimer";
import { SectionHeader } from "@/components/layout/section-header";
import { stockHref } from "@/components/layout/nav-config";
import { ChangeValue } from "@/components/market/change-value";
import { DivergenceCallout, groupName, signedIdr, StockDivergence, UnverifiedBadge } from "@/components/market/group-parts";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Link } from "@/i18n/navigation";
import { useGroups } from "@/lib/api/hooks";
import { GROUP_WINDOWS, type GroupPerformance, type GroupsView as GroupsData, type GroupWindow } from "@/lib/api/market";
import { freshnessMeta } from "@/lib/freshness";
import { formatDate, formatIdr, formatValue, type Locale } from "@/lib/format";

/**
 * Conglomerate groups over a session window: measured facts only (price change, value, breadth, a net foreign
 * estimate) and, where price and foreign flow disagree, a plain statement saying so. No phase or action labels.
 */
export function GroupsView() {
  const t = useTranslations("groups");
  const [window, setWindow] = useQueryState("window", parseAsStringLiteral(GROUP_WINDOWS).withDefault("1D"));
  const query = useGroups(window);
  return (
    <div className="flex flex-col gap-section p-4 md:p-6" data-testid="groups-view">
      <SectionHeader as="h1" title={t("title")} description={t("intro")} meta={query.data ? freshnessMeta(query.data) : undefined} />
      <div className="flex flex-col gap-3">
        <ToggleGroup type="single" size="sm" variant="outline" value={window} onValueChange={(value) => value && void setWindow(value as GroupWindow)} aria-label={t("windowLabel")} className="self-start">
          {GROUP_WINDOWS.map((value) => <ToggleGroupItem key={value} value={value} className="px-2.5 text-xs" data-testid={`groups-window-${value}`}>{t(`window.${value}`)}</ToggleGroupItem>)}
        </ToggleGroup>
        <p className="caption-style max-w-3xl leading-snug text-subtle">{t("howToRead")}</p>
      </div>
      <DataState query={query}>
        {(envelope) => envelope.data.groups.length === 0
          ? <EmptyState icon={<Network />} title={t("empty")} description={<CatalogLine data={envelope.data} />} />
          : <GroupList data={envelope.data} />}
      </DataState>
      <ResearchDisclaimer />
    </div>
  );
}

function CatalogLine({ data }: { data: GroupsData }) {
  const t = useTranslations("groups");
  const locale = useLocale() as Locale;
  return <span data-testid="groups-catalog">{t("catalog", { version: data.catalog.version, date: formatDate(data.catalog.reviewedAt, locale) })}</span>;
}

function WindowLine({ data }: { data: GroupsData }) {
  const t = useTranslations("groups");
  const locale = useLocale() as Locale;
  const { window } = data;
  if (!window.from || !window.to) return null;
  return (
    <p className="caption-style text-subtle" data-testid="groups-window-range">
      {window.from === window.to ? t("windowSingle", { date: formatDate(window.to, locale) }) : t("windowRange", { sessions: window.sessions, from: formatDate(window.from, locale), to: formatDate(window.to, locale) })}
      {window.basis === "intraday" && <> · {t("intradayNote")}</>}
    </p>
  );
}

function GroupList({ data }: { data: GroupsData }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <WindowLine data={data} />
        <p className="caption-style text-subtle"><CatalogLine data={data} /></p>
      </div>
      <ul className="flex flex-col gap-3" data-testid="groups-list">
        {data.groups.map((group) => <GroupCard key={group.id} group={group} intraday={data.window.basis === "intraday"} />)}
      </ul>
    </section>
  );
}

function ForeignLine({ group, intraday }: { group: GroupPerformance; intraday: boolean }) {
  const t = useTranslations("groups");
  const locale = useLocale() as Locale;
  if (intraday) return <span className="text-muted-foreground">{t("foreignIntraday")}</span>;
  if (group.foreign.netValueEstimateIdr === null) return <span className="text-muted-foreground">{t("foreignNone")}</span>;
  return (
    <span className="flex flex-col">
      <span className="num">{signedIdr(group.foreign.netValueEstimateIdr, locale)}</span>
      <span className="text-[11px] text-muted-foreground" data-testid="group-foreign-coverage">
        {t("foreignCoverage", { covered: group.foreign.members, count: group.membersWithData })}
        {group.foreign.partialMembers > 0 && <> · {t("foreignPartial", { partial: group.foreign.partialMembers })}</>}
      </span>
    </span>
  );
}

function GroupCard({ group, intraday }: { group: GroupPerformance; intraday: boolean }) {
  const t = useTranslations("groups");
  const locale = useLocale() as Locale;
  const hasData = group.membersWithData > 0;
  return (
    <li className="rounded-xl border border-border" data-testid={`group-${group.id}`}>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="flex flex-wrap items-center gap-2 text-sm font-medium">
              {groupName(group, locale)}
              {group.confidence === "unverified" && <UnverifiedBadge />}
            </h2>
            <span className="caption-style text-subtle">
              {hasData ? t("breadth", { up: group.advancers, down: group.decliners, count: group.membersWithData, members: group.members }) : t("noData")}
            </span>
          </div>
          {hasData && (
            <div className="flex flex-col items-end">
              <ChangeValue percent={group.valueWeightedChangePercent ?? group.changePercent} className="text-base" />
              <span className="text-[11px] text-muted-foreground">
                {group.valueWeightedChangePercent !== null ? t("vwChange") : t("meanOnly")}
              </span>
            </div>
          )}
        </div>
        {hasData && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
            <div className="flex flex-col"><dt className="text-muted-foreground">{t("meanChange")}</dt><dd><ChangeValue percent={group.changePercent} /></dd></div>
            <div className="flex flex-col"><dt className="text-muted-foreground">{t("value")}</dt><dd className="num">{formatIdr(group.valueIdr, locale, { compact: true })}</dd></div>
            <div className="flex flex-col"><dt className="text-muted-foreground">{t("foreign")}</dt><dd><ForeignLine group={group} intraday={intraday} /></dd></div>
            <div className="flex flex-col">
              <dt className="text-muted-foreground">{t("bestWorst")}</dt>
              <dd className="flex flex-wrap gap-x-2">
                {group.best && <span><span className="ticker">{group.best.symbol}</span> <ChangeValue percent={group.best.changePercent} /></span>}
                {group.worst && group.worst.symbol !== group.best?.symbol && <span><span className="ticker">{group.worst.symbol}</span> <ChangeValue percent={group.worst.changePercent} /></span>}
              </dd>
            </div>
          </dl>
        )}
        <DivergenceCallout group={group} />
        <Collapsible>
          <CollapsibleTrigger className="caption-style text-link hover:underline" data-testid={`group-${group.id}-toggle`}>
            {t("showMembers", { count: group.members })}
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-3 pt-3">
            {group.stocks.length > 0 && <MemberTable group={group} intraday={intraday} />}
            <DataGaps group={group} />
            {group.note && <p className="caption-style text-subtle"><span className="text-muted-foreground">{t("curatorNote")}: </span>{group.note}</p>}
            <div className="flex flex-col gap-1" data-testid={`group-${group.id}-sources`}>
              <span className="caption-style text-muted-foreground">{t("sources", { date: formatDate(group.reviewedAt, locale) })}</span>
              <ul className="flex flex-col gap-0.5 text-xs">
                {group.sources.map((source) => (
                  <li key={source.url}>
                    <a href={source.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-link hover:underline">
                      {source.label}<ExternalLink aria-hidden className="size-3" />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </li>
  );
}

function MemberTable({ group, intraday }: { group: GroupPerformance; intraday: boolean }) {
  const t = useTranslations("groups");
  const locale = useLocale() as Locale;
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[36rem] text-xs" data-testid={`group-${group.id}-members`}>
        <TableHeader>
          <TableRow interactive={false}>
            <TableHead className="h-auto px-0 py-1.5 text-xs whitespace-normal text-muted-foreground pr-3">{t("colStock")}</TableHead>
            <TableHead numeric className="h-auto px-0 py-1.5 text-xs whitespace-normal text-muted-foreground pr-3">{t("colClose")}</TableHead>
            <TableHead numeric className="h-auto px-0 py-1.5 text-xs whitespace-normal text-muted-foreground pr-3">{t("colChange")}</TableHead>
            <TableHead numeric className="h-auto px-0 py-1.5 text-xs whitespace-normal text-muted-foreground pr-3">{t("colValue")}</TableHead>
            <TableHead numeric className="h-auto px-0 py-1.5 text-xs whitespace-normal text-muted-foreground">{t("colForeign")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="[&>tr:last-child>td]:border-b-0">
          {group.stocks.map((stock) => (
            <TableRow key={stock.symbol} className="align-top">
              <TableCell className="px-0 py-1.5 pr-3 align-top">
                <div className="flex flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Link href={stockHref(stock.symbol)} className="ticker text-link hover:underline">{stock.symbol}</Link>
                    {stock.confidence === "unverified" && <UnverifiedBadge />}
                  </span>
                  {stock.name && <span className="max-w-64 truncate text-muted-foreground">{stock.name}</span>}
                  {stock.note && <span className="max-w-80 text-[11px] text-subtle">{stock.note}</span>}
                  <StockDivergence stock={stock} />
                </div>
              </TableCell>
              <TableCell className="num px-0 py-1.5 pr-3 text-right align-top">{formatValue(stock.close, "number", locale)}</TableCell>
              <TableCell className="px-0 py-1.5 pr-3 text-right align-top">
                {stock.corporateAction ? <span className="text-[11px] text-muted-foreground" title={t("corporateActionHint")}>{t("corporateAction")}</span> : <ChangeValue percent={stock.changePercent} />}
              </TableCell>
              <TableCell className="num px-0 py-1.5 pr-3 text-right align-top">{formatIdr(stock.valueIdr, locale, { compact: true })}</TableCell>
              <TableCell className="num px-0 py-1.5 text-right align-top">
                {intraday ? "—" : signedIdr(stock.netForeignValueEstimateIdr, locale)}
                {!intraday && stock.foreignSessions > 0 && stock.foreignSessions < stock.sessions && (
                  <span className="block text-[11px] text-muted-foreground">{t("foreignSessions", { covered: stock.foreignSessions, sessions: stock.sessions })}</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Catalog members the engine could not measure, named so a stale or wrong entry is visible. */
function DataGaps({ group }: { group: GroupPerformance }) {
  const t = useTranslations("groups");
  const lines = [
    group.unknownSymbols.length ? t("unknownSymbols", { symbols: group.unknownSymbols.join(", ") }) : null,
    group.inactiveSymbols.length ? t("inactiveSymbols", { symbols: group.inactiveSymbols.join(", ") }) : null,
    group.noDataSymbols.length ? t("noDataSymbols", { symbols: group.noDataSymbols.join(", ") }) : null,
  ].filter((line): line is string => line !== null);
  if (!lines.length) return null;
  return (
    <ul className="caption-style flex flex-col gap-0.5 text-subtle" data-testid={`group-${group.id}-gaps`}>
      {lines.map((line) => <li key={line}>{line}</li>)}
    </ul>
  );
}
