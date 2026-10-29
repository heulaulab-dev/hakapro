"use client";

import { Pause, Play, SkipBack, SkipForward } from "@/components/kit/icons";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { DataState } from "@/components/feedback/data-state";
import { ResearchDisclaimer } from "@/components/feedback/research-disclaimer";
import { Link } from "@/i18n/navigation";
import { SectionHeader } from "@/components/layout/section-header";
import { Segmented } from "@/components/kit/segmented";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useBreadthHistory, useIndicesHistory, useIssuerRace } from "@/lib/api/hooks";
import type { BreadthHistory } from "@/server/schemas/market-intelligence";
import type { IndexSeries, IssuerRace } from "@/lib/api/market";
import { breadthAtDate, indexReturnAtDate } from "@/lib/market-replay";
import { leastFresh } from "@/lib/freshness";
import { formatDate, formatNumber, type Locale } from "@/lib/format";

const WINDOWS = ["1M", "3M", "6M", "1Y"] as const;
type Window = (typeof WINDOWS)[number];

export function MarketReplayView() {
  const t = useTranslations("marketReplay");
  const [window, setWindow] = useState<Window>("1M");
  const raceQuery = useIssuerRace(window, "all");
  const breadthQuery = useBreadthHistory(window);
  const indicesQuery = useIndicesHistory({ from: raceQuery.data?.data.from ?? undefined, to: raceQuery.data?.data.to ?? undefined });
  const locale = useLocale() as Locale;
  const feeds = [raceQuery.data, breadthQuery.data, indicesQuery.data];
  const freshness = feeds.every(Boolean) ? leastFresh(feeds.map((feed) => feed!.freshness)) : null;
  const asOfs = feeds.map((feed) => feed?.asOf ?? null);
  const oldestAsOf = asOfs.filter((date): date is string => date !== null).sort()[0] ?? null;
  const freshnessInfo = freshness ? { freshness, asOf: oldestAsOf, source: "HAKA PRO Engine" } : undefined;

  return (
    <div className="flex flex-col gap-section p-4 md:p-6" data-testid="market-replay-view">
      <SectionHeader as="h1" title={t("title")} description={t("intro")} meta={freshnessInfo}
        actions={<div className="flex flex-col gap-1 text-xs text-muted-foreground"><span>{t("window")}</span><Segmented value={window} onChange={(value) => setWindow(value as Window)} options={WINDOWS.map((value) => ({ value, label: value }))} /> </div>} />
      {feeds.every(Boolean) && <p className="caption-style text-subtle" data-testid="market-replay-data-asof">
        {t("datasetAsOf", { race: formatDate(raceQuery.data!.asOf, locale), breadth: formatDate(breadthQuery.data!.asOf, locale), indices: formatDate(indicesQuery.data!.asOf, locale) })}
      </p>}
      <DataState query={raceQuery} compact>
        {(race) => <DataState query={breadthQuery} compact>
          {(breadth) => race.data.from && race.data.to
            ? <DataState query={indicesQuery} compact>
              {(indices) => <Workspace key={window} race={race.data} breadth={breadth.data} indices={indices.data} />}
            </DataState>
            : <Workspace key={window} race={race.data} breadth={breadth.data} indices={{ series: [] }} />
          }
        </DataState>}
      </DataState>
      <ResearchDisclaimer />
    </div>
  );
}

function Workspace({ race, breadth, indices }: { race: IssuerRace; breadth: BreadthHistory; indices: { series: IndexSeries[] } }) {
  const t = useTranslations("marketReplay");
  const locale = useLocale() as Locale;
  const [activeIndex, setActiveIndex] = useState(Math.max(0, race.frames.length - 1));
  const [sectorCode, setSectorCode] = useState("IDXFINANCE");
  const [playing, setPlaying] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const index = Math.min(activeIndex, Math.max(0, race.frames.length - 1));
  const frame = race.frames[index];
  const sessionBreadth = frame ? breadthAtDate(breadth, frame.date) : null;
  const sectorReturn = frame ? indexReturnAtDate(indices, sectorCode, race.from, frame.date) : null;
  const benchmarkReturn = frame ? indexReturnAtDate(indices, "COMPOSITE", race.from, frame.date) : null;
  const sectors = indices.series.filter((series) => series.code.startsWith("IDX"));

  useEffect(() => {
    const query = globalThis.window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (reducedMotion || !playing || race.frames.length < 2) return;
    const id = setInterval(() => setActiveIndex((current) => {
      if (current >= race.frames.length - 1) { setPlaying(false); return race.frames.length - 1; }
      return current + 1;
    }), 800);
    return () => clearInterval(id);
  }, [playing, reducedMotion, race.frames.length]);

  const step = (delta: number) => {
    setPlaying(false);
    setActiveIndex((current) => Math.max(0, Math.min(race.frames.length - 1, current + delta)));
  };
  const percent = (value: number | null | undefined) => value === null || value === undefined ? "—" : `${value >= 0 ? "+" : ""}${formatNumber(value * 100, locale, { decimals: 1, minDecimals: 1 })}%`;
  const returnText = (value: number | null) => value === null ? "—" : `${value >= 0 ? "+" : ""}${formatNumber(value, locale, { decimals: 1, minDecimals: 1 })}%`;

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 md:p-4" data-testid="market-replay">
      <SectionHeader as="h2" title={t("replayTitle")} description={t("replayDescription")} actions={
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">{t("sector")}
          <Select value={sectorCode} onValueChange={setSectorCode}>
            <SelectTrigger className="h-8 min-w-44 text-sm" data-testid="market-replay-sector"><SelectValue /></SelectTrigger>
            <SelectContent>{sectors.map((series) => <SelectItem key={series.code} value={series.code}>{series.name ?? series.code}</SelectItem>)}</SelectContent>
          </Select>
        </label>
      } />

      {frame ? <>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" data-testid="market-replay-context">
          <span data-testid="market-replay-date">{t("selectedSession", { date: formatDate(frame.date, locale) })}</span>
          <span data-testid="market-replay-coverage">{t("coverage", { priced: frame.priced, baseline: race.universe.withBaseline, active: race.universe.active })}</span>
          {race.universe.truncated && <span className="text-warning">{t("universeCapped")}</span>}
          <span>{t("frameCount", { current: index + 1, total: race.frames.length })}</span>
        </div>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
          <Metric label={t("advancers")} value={sessionBreadth ? String(sessionBreadth.advancers) : "—"} testId="market-replay-advancers" />
          <Metric label={t("decliners")} value={sessionBreadth ? String(sessionBreadth.decliners) : "—"} testId="market-replay-decliners" />
          <Metric label={t("netAdvanceRate")} value={sessionBreadth ? percent(sessionBreadth.netAdvanceRate) : "—"} />
          <Metric label={t("aboveSma20")} value={sessionBreadth ? percent(sessionBreadth.aboveSma20Pct) : "—"} />
          <Metric label={t("sectorReturn", { sector: sectors.find((item) => item.code === sectorCode)?.name ?? sectorCode })} value={sectorReturn ? returnText(sectorReturn.returnPercent) : "—"} testId="market-replay-sector-return" />
          <Metric label={t("ihsgReturn")} value={benchmarkReturn ? returnText(benchmarkReturn.returnPercent) : "—"} testId="market-replay-ihsg-return" />
        </div>
        {!sessionBreadth && <p role="status" className="text-xs text-warning" data-testid="market-replay-breadth-missing">{t("missingForSession", { metric: t("breadthLabel") })}</p>}
        {(!sectorReturn || !benchmarkReturn) && <p role="status" className="text-xs text-warning" data-testid="market-replay-index-missing">{t("missingForSession", { metric: t("indexLabel") })}</p>}
        {sessionBreadth && <p className="caption-style text-subtle" data-testid="market-replay-breadth-coverage">{t("breadthCoverage", { comparable: sessionBreadth.comparable, observed: sessionBreadth.observed })}</p>}

        <section className="flex flex-col gap-2" aria-labelledby="market-replay-leaders-heading">
          <SectionHeader as="h3" title={<span id="market-replay-leaders-heading">{t("leadersTitle")}</span>} description={t("leadersDescription")} />
          {frame.leaders.length ? <ol className="flex flex-col gap-1.5">
            {frame.leaders.map((leader, position) => {
              const width = `${Math.min(100, Math.abs(leader.returnPercent) / Math.max(1, ...frame.leaders.map((item) => Math.abs(item.returnPercent))) * 100)}%`;
              const positive = leader.returnPercent >= 0;
              return <li key={leader.symbol} className="grid grid-cols-[2rem_minmax(4rem,6rem)_minmax(5rem,1fr)_5rem] items-center gap-2 rounded-md px-1 py-1" data-testid="market-replay-leader">
                <span className="num text-right text-xs text-faint">{String(position + 1).padStart(2, "0")}</span>
                <Link href={`/stock/${leader.symbol}`} className="ticker text-sm font-semibold text-link hover:underline">{leader.symbol}</Link>
                <span className="relative h-5 overflow-hidden rounded bg-secondary" aria-hidden="true">
                  <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
                  <span className={`absolute inset-y-0 ${positive ? "left-1/2 bg-(--tag-green-bg)" : "right-1/2 bg-(--tag-red-bg)"} ${reducedMotion ? "" : "transition-[width] duration-500 ease-out"}`} style={{ width }} />
                </span>
                <span className={`num text-right text-sm font-semibold ${positive ? "text-(--tag-green-text)" : "text-(--tag-red-text)"}`}>{returnText(leader.returnPercent)}</span>
              </li>;
            })}
          </ol> : <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">{t("noLeaders")}</p>}
        </section>

        <div className="flex items-center gap-2 border-t border-border pt-2" data-testid="market-replay-playback">
          <Button variant="ghost" size="icon-sm" aria-label={t("previousSession")} disabled={index <= 0} onClick={() => step(-1)}><SkipBack /></Button>
          {!reducedMotion && <Button variant="outline" size="sm" onClick={() => setPlaying((value) => !value)}>{playing ? <Pause /> : <Play />}{playing ? t("pause") : t("play")}</Button>}
          <Button variant="ghost" size="icon-sm" aria-label={t("nextSession")} disabled={index >= race.frames.length - 1} onClick={() => step(1)}><SkipForward /></Button>
          <Slider value={[index]} min={0} max={Math.max(0, race.frames.length - 1)} step={1} aria-label={t("timeline")} onValueChange={([value]) => { setPlaying(false); setActiveIndex(value); }} className="mx-2" data-testid="market-replay-slider" />
          <span className="num min-w-24 text-right text-xs text-muted-foreground">{race.from ? formatDate(race.from, locale) : "—"} – {race.to ? formatDate(race.to, locale) : "—"}</span>
        </div>
      </> : <p className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted-foreground">{t("noFrames")}</p>}
      <p className="caption-style text-faint">{t("methodology")}</p>
    </section>
  );
}

function Metric({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return <div className="flex min-h-18 flex-col justify-center rounded-lg border border-border p-3">
    <span className="caption-style text-subtle">{label}</span>
    <span className="num text-lg font-semibold" data-testid={testId}>{value}</span>
  </div>;
}
