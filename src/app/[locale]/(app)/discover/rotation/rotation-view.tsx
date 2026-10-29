"use client";

import { useEffect, useMemo, useState } from "react";
import { Pause, Play, RotateCcw, SkipBack, SkipForward } from "@/components/kit/icons";
import { useLocale, useTranslations } from "next-intl";
import { DataState } from "@/components/feedback/data-state";
import { EmptyState } from "@/components/feedback/empty-state";
import { ResearchDisclaimer } from "@/components/feedback/research-disclaimer";
import { SectionHeader } from "@/components/layout/section-header";
import { Segmented } from "@/components/kit/segmented";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RrgChart, type RrgChartSeries } from "@/components/charts/rrg-chart";
import { useIndicesHistory } from "@/lib/api/hooks";
import type { IndexCoverageReport, IndexSeries } from "@/lib/api/market";
import { freshnessMeta } from "@/lib/freshness";
import { IssuerRacePanel } from "./issuer-race-panel";
import { formatDate, type Locale } from "@/lib/format";
import {
  computeRotation, directionVector, minObservations, QUADRANTS, RRG_PARAM_DEFAULTS,
  type Quadrant, type RotationResult, type RrgInterval, type RrgPoint, type SectorInput,
} from "@/lib/sector-rotation";

const BENCHMARKS = [{ code: "COMPOSITE", label: "IHSG" }, { code: "LQ45", label: "LQ45" }, { code: "IDX30", label: "IDX30" }];
/** The 11 IDX-IC sectors, in classification order. Only those present in the data are plotted. */
const SECTOR_NAMES: Record<string, string> = {
  IDXENERGY: "Energy", IDXBASIC: "Basic Materials", IDXINDUST: "Industrials", IDXNONCYC: "Consumer Non-Cyclicals",
  IDXCYCLIC: "Consumer Cyclicals", IDXHEALTH: "Healthcare", IDXFINANCE: "Financials", IDXPROPERT: "Properties & Real Estate",
  IDXTECHNO: "Technology", IDXINFRA: "Infrastructures", IDXTRANS: "Transportation & Logistics",
};
const SECTOR_ORDER = Object.keys(SECTOR_NAMES);
const TAIL_LENGTHS = [4, 8, 12] as const;
const n2 = (n: number) => n.toFixed(2);

export function RotationView() {
  const t = useTranslations("sectorRotation");
  const query = useIndicesHistory();
  return (
    <div className="flex flex-col gap-section p-4 md:p-6" data-testid="rotation-view">
      <SectionHeader as="h1" title={t("title")} description={t("intro")} />
      <p className="caption-style text-subtle" data-testid="rotation-experimental">{t("experimental")}</p>
      <DataState query={query}>
        {(envelope) => <Workspace series={envelope.data.series} coverage={envelope.data.coverage ?? []} meta={freshnessMeta(envelope)} />}
      </DataState>
      <IssuerRacePanel />
      <ResearchDisclaimer />
    </div>
  );
}

function Workspace({ series, coverage, meta }: { series: IndexSeries[]; coverage: IndexCoverageReport[]; meta: ReturnType<typeof freshnessMeta> }) {
  const t = useTranslations("sectorRotation");
  const [benchmark, setBenchmark] = useState("COMPOSITE");
  const [interval, setIntervalState] = useState<RrgInterval>("daily");
  const [tail, setTail] = useState(8);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [playIndex, setPlayIndex] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);

  const reset = () => { setBenchmark("COMPOSITE"); setIntervalState("daily"); setTail(8); setHighlight(null); setHidden(new Set()); setPlayIndex(null); setPlaying(false); };

  const benchSeries = series.find((s) => s.code === benchmark);
  const presentSectors = useMemo(() => SECTOR_ORDER.filter((code) => series.some((s) => s.code === code)), [series]);
  const sectors = useMemo<SectorInput[]>(
    () => presentSectors.map((code) => ({ id: code, name: SECTOR_NAMES[code], series: series.find((s) => s.code === code)!.points })),
    [presentSectors, series],
  );
  const result = useMemo<RotationResult | null>(
    () => (benchSeries ? computeRotation({ id: benchmark, series: benchSeries.points }, sectors, interval, RRG_PARAM_DEFAULTS[interval]) : null),
    [benchSeries, benchmark, sectors, interval],
  );

  const timeline = useMemo(() => (result ? [...new Set(result.rotations.flatMap((r) => r.points.map((p) => p.date)))].sort() : []), [result]);
  const activeIndex = playIndex ?? (timeline.length - 1);
  const activeDate: string | undefined = timeline[activeIndex];

  useEffect(() => {
    if (!playing || timeline.length === 0) return;
    const id = setInterval(() => {
      setPlayIndex((prev) => {
        const current = prev ?? (timeline.length - 1);
        if (current >= timeline.length - 1) { setPlaying(false); return timeline.length - 1; }
        return current + 1;
      });
    }, 900);
    return () => clearInterval(id);
  }, [playing, timeline.length]);

  const chartSeries = useMemo<RrgChartSeries[]>(() => {
    if (!result || !activeDate) return [];
    return result.rotations
      .filter((r) => !hidden.has(r.sectorId) && r.points.length > 0)
      .map((r) => ({ code: r.sectorId, name: r.sectorName, colorIndex: presentSectors.indexOf(r.sectorId), tail: r.points.filter((p) => p.date <= activeDate).slice(-tail) }))
      .filter((s) => s.tail.length > 0);
  }, [result, activeDate, hidden, tail, presentSectors]);

  if (!benchSeries) return <EmptyState title={t("noBenchmark", { code: benchmark })} />;
  const required = result?.required ?? minObservations(RRG_PARAM_DEFAULTS[interval]);
  const toggleHidden = (code: string) => setHidden((prev) => {
    const next = new Set(prev);
    if (next.has(code)) next.delete(code); else next.add(code);
    return next;
  });

  return (
    <div className="flex flex-col gap-section">
      <SectionHeader title={t("rrgTitle")} description={t("rrgDesc", { benchmark: BENCHMARKS.find((b) => b.code === benchmark)?.label ?? benchmark })} meta={meta}
        actions={
          <div className="flex flex-wrap items-end gap-2" data-testid="rotation-controls">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">{t("benchmark")}
              <Select value={benchmark} onValueChange={setBenchmark}>
                <SelectTrigger className="h-8 w-28 text-sm" data-testid="rotation-benchmark"><SelectValue /></SelectTrigger>
                <SelectContent>{BENCHMARKS.filter((b) => series.some((s) => s.code === b.code)).map((b) => <SelectItem key={b.code} value={b.code}>{b.label}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <div className="flex flex-col gap-1 text-xs text-muted-foreground"><span>{t("interval")}</span>
              <Segmented value={interval} onChange={(v) => setIntervalState(v as RrgInterval)} options={[{ value: "daily", label: t("daily") }, { value: "weekly", label: t("weekly") }]} />
            </div>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">{t("tail")}
              <Select value={String(tail)} onValueChange={(v) => setTail(Number(v))}>
                <SelectTrigger className="h-8 w-20 text-sm" data-testid="rotation-tail"><SelectValue /></SelectTrigger>
                <SelectContent>{TAIL_LENGTHS.map((nn) => <SelectItem key={nn} value={String(nn)}>{nn}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <Button variant="outline" size="sm" onClick={reset}><RotateCcw />{t("reset")}</Button>
          </div>
        } />

      <SourceHistoryCoverage coverage={coverage} interval={interval} />

      {!result || !result.sufficient ? (
        <Insufficient result={result} required={required} interval={interval} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_20rem]">
            <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
              <RrgChart series={chartSeries} highlight={highlight} />
              <Playback timeline={timeline} activeIndex={activeIndex} activeDate={activeDate} playing={playing}
                onStep={(i) => { setPlaying(false); setPlayIndex(i); }} onToggle={() => setPlaying((p) => !p)} onLive={() => { setPlaying(false); setPlayIndex(null); }} />
            </div>
            <Detail result={result} activeDate={activeDate} highlight={highlight} />
          </div>
          <Rankings result={result} activeDate={activeDate} highlight={highlight} hidden={hidden} onHighlight={setHighlight} onToggleHidden={toggleHidden} />
          <Insights result={result} activeDate={activeDate} />
        </>
      )}
      <MethodologyNote />
    </div>
  );
}

function SourceHistoryCoverage({ coverage, interval }: { coverage: IndexCoverageReport[]; interval: RrgInterval }) {
  const t = useTranslations("sectorRotation");
  const locale = useLocale() as Locale;
  const byCode = new Map(coverage.map((row) => [row.code, row]));
  const required = minObservations(RRG_PARAM_DEFAULTS[interval]);
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border p-3" data-testid="rotation-source-coverage">
      <SectionHeader as="h2" title={t("historyCoverageTitle")} description={t("historyCoverageDescription", { required })} />
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-data">
          <thead><tr className="text-left text-xs text-muted-foreground">
            <th className="px-cell-x py-cell-y font-medium">{t("sector")}</th>
            <th className="px-cell-x py-cell-y text-right font-medium">{t("historyObservations")}</th>
            <th className="px-cell-x py-cell-y text-right font-medium">{t("historyLatest")}</th>
          </tr></thead>
          <tbody>
            {SECTOR_ORDER.map((code) => {
              const row = byCode.get(code);
              return (
                <tr key={code} className="h-row border-t border-border" data-testid={`source-coverage-${code}`}>
                  <td className="px-cell-x py-cell-y"><span className="ticker">{code}</span> <span className="text-muted-foreground">{SECTOR_NAMES[code]}</span></td>
                  <td className="num px-cell-x py-cell-y text-right">{row?.count ?? 0}</td>
                  <td className="px-cell-x py-cell-y text-right">{row?.lastDate ? formatDate(row.lastDate, locale) : t("noHistory")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Latest valid point at or before `date` (playback-safe; never future). */
function pointAt(points: RrgPoint[], date: string | undefined): RrgPoint | null {
  if (!date) return points.at(-1) ?? null;
  return points.filter((p) => p.date <= date).at(-1) ?? null;
}

function QuadrantBadge({ quadrant }: { quadrant: Quadrant }) {
  const t = useTranslations("sectorRotation");
  const tone: Record<Quadrant, string> = {
    leading: "bg-positive/15 text-positive", weakening: "bg-warning/15 text-warning",
    improving: "bg-[var(--series-2)]/15 text-[var(--series-2)]", lagging: "bg-negative/15 text-negative",
  };
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tone[quadrant]}`}>{t(`quadrants.${quadrant}`)}</span>;
}

function Rankings({ result, activeDate, highlight, hidden, onHighlight, onToggleHidden }: {
  result: RotationResult; activeDate: string | undefined; highlight: string | null; hidden: Set<string>;
  onHighlight: (code: string | null) => void; onToggleHidden: (code: string) => void;
}) {
  const t = useTranslations("sectorRotation");
  const rows = result.rotations
    .map((r) => ({ r, point: pointAt(r.points, activeDate), vector: directionVector(r.points.filter((p) => !activeDate || p.date <= activeDate).slice(-2)) }))
    .filter((row): row is { r: RotationResult["rotations"][number]; point: RrgPoint; vector: ReturnType<typeof directionVector> } => row.point !== null)
    .sort((a, b) => b.point.rsRatio - a.point.rsRatio);
  return (
    <section className="flex flex-col gap-2" data-testid="rotation-rankings">
      <SectionHeader title={t("rankingsTitle")} description={t("rankingsDesc")} />
      <div className="overflow-x-auto rounded-xl border border-border">
        <Table>
          <TableHeader><TableRow interactive={false}>
            <TableHead className="h-auto px-(--spacing-cell-x) py-cell-y text-xs font-medium whitespace-normal text-muted-foreground">{t("sector")}</TableHead>
            <TableHead numeric className="h-auto px-(--spacing-cell-x) py-cell-y text-xs font-medium whitespace-normal text-muted-foreground">{t("rsRatio")}</TableHead>
            <TableHead numeric className="h-auto px-(--spacing-cell-x) py-cell-y text-xs font-medium whitespace-normal text-muted-foreground">{t("rsMomentum")}</TableHead>
            <TableHead className="h-auto px-(--spacing-cell-x) py-cell-y text-xs font-medium whitespace-normal text-muted-foreground">{t("quadrant")}</TableHead>
            <TableHead numeric className="h-auto px-(--spacing-cell-x) py-cell-y text-xs font-medium whitespace-normal text-muted-foreground">{t("momentumChange")}</TableHead>
            <TableHead className="h-auto px-(--spacing-cell-x) py-cell-y text-xs font-medium whitespace-normal text-muted-foreground" />
          </TableRow></TableHeader>
          <TableBody>
            {rows.map(({ r, point, vector }) => (
              <TableRow key={r.sectorId} onMouseEnter={() => onHighlight(r.sectorId)} onMouseLeave={() => onHighlight(null)}
                className={`h-row ${highlight === r.sectorId ? "bg-(--overlay-soft)" : ""} ${hidden.has(r.sectorId) ? "opacity-40" : ""}`} data-testid={`rank-${r.sectorId}`}>
                <TableCell className="px-(--spacing-cell-x)"><span className="ticker font-medium">{r.sectorId}</span> <span className="text-muted-foreground">{r.sectorName}</span></TableCell>
                <TableCell className="num px-(--spacing-cell-x) text-right">{n2(point.rsRatio)}</TableCell>
                <TableCell className="num px-(--spacing-cell-x) text-right">{n2(point.rsMomentum)}</TableCell>
                <TableCell className="px-(--spacing-cell-x)"><QuadrantBadge quadrant={point.quadrant} /></TableCell>
                <TableCell className={`num px-(--spacing-cell-x) text-right ${vector && vector.dy >= 0 ? "text-positive" : "text-negative"}`}>{vector ? `${vector.dy >= 0 ? "+" : ""}${n2(vector.dy)}` : "—"}</TableCell>
                <TableCell className="px-(--spacing-cell-x) text-right"><Button variant="ghost" size="sm" aria-pressed={!hidden.has(r.sectorId)} onClick={() => onToggleHidden(r.sectorId)}>{hidden.has(r.sectorId) ? t("show") : t("hide")}</Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function Detail({ result, activeDate, highlight }: { result: RotationResult; activeDate: string | undefined; highlight: string | null }) {
  const t = useTranslations("sectorRotation");
  const locale = useLocale() as Locale;
  const pick = highlight ?? result.rotations.find((r) => r.points.length)?.sectorId ?? null;
  const rotation = result.rotations.find((r) => r.sectorId === pick);
  const point = rotation ? pointAt(rotation.points, activeDate) : null;
  const trajectory = rotation ? rotation.points.filter((p) => !activeDate || p.date <= activeDate).slice(-5) : [];
  const vector = directionVector(trajectory.slice(-2));
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border p-3" data-testid="rotation-detail">
      <SectionHeader as="h3" title={t("detailTitle")} />
      {!rotation || !point ? <EmptyState compact title={t("detailEmpty")} /> : (
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex items-center justify-between"><span><span className="ticker font-medium">{rotation.sectorId}</span> <span className="text-muted-foreground">{rotation.sectorName}</span></span><QuadrantBadge quadrant={point.quadrant} /></div>
          <dl className="grid grid-cols-2 gap-1 text-xs">
            <div><dt className="text-muted-foreground">{t("rsRatio")}</dt><dd className="num">{n2(point.rsRatio)}</dd></div>
            <div><dt className="text-muted-foreground">{t("rsMomentum")}</dt><dd className="num">{n2(point.rsMomentum)}</dd></div>
            <div><dt className="text-muted-foreground">{t("heading")}</dt><dd className="num">{vector ? `${vector.angleDeg >= 0 ? "+" : ""}${vector.angleDeg.toFixed(0)}°` : "—"}</dd></div>
            <div><dt className="text-muted-foreground">{t("velocity")}</dt><dd className="num">{vector ? n2(vector.velocity) : "—"}</dd></div>
          </dl>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t("trajectory")}</span>
            {trajectory.map((p) => <div key={p.date} className="num flex justify-between text-xs"><span>{formatDate(p.date, locale)}</span><span>{n2(p.rsRatio)} / {n2(p.rsMomentum)}</span></div>)}
          </div>
          <p className="caption-style text-subtle">{t("asOf", { date: formatDate(point.date, locale) })}</p>
        </div>
      )}
    </section>
  );
}

function Insights({ result, activeDate }: { result: RotationResult; activeDate: string | undefined }) {
  const t = useTranslations("sectorRotation");
  const items: string[] = [];
  for (const r of result.rotations) {
    const pts = r.points.filter((p) => !activeDate || p.date <= activeDate);
    const last = pts.at(-1); const prev = pts.at(-2);
    if (!last) continue;
    if (prev && prev.quadrant !== last.quadrant) items.push(t("insight.moved", { sector: r.sectorId, from: t(`quadrants.${prev.quadrant}`), to: t(`quadrants.${last.quadrant}`) }));
    const three = pts.slice(-3);
    if (three.length === 3 && three[0].rsMomentum < three[1].rsMomentum && three[1].rsMomentum < three[2].rsMomentum) items.push(t("insight.momentumUp", { sector: r.sectorId }));
    if (three.length === 3 && three[0].rsMomentum > three[1].rsMomentum && three[1].rsMomentum > three[2].rsMomentum) items.push(t("insight.momentumDown", { sector: r.sectorId }));
    if (prev && prev.rsRatio < 100 && last.rsRatio >= 100) items.push(t("insight.crossedUp", { sector: r.sectorId }));
    if (prev && prev.rsRatio >= 100 && last.rsRatio < 100) items.push(t("insight.crossedDown", { sector: r.sectorId }));
  }
  if (!items.length) return null;
  return (
    <section className="flex flex-col gap-2" data-testid="rotation-insights">
      <SectionHeader title={t("insightsTitle")} description={t("insightsDesc")} />
      <ul className="flex flex-col gap-1 rounded-xl border border-border p-3 text-sm">
        {items.slice(0, 8).map((item, i) => <li key={i} className="flex gap-2"><span aria-hidden className="text-muted-foreground">•</span>{item}</li>)}
      </ul>
    </section>
  );
}

function Playback({ timeline, activeIndex, activeDate, playing, onStep, onToggle, onLive }: {
  timeline: string[]; activeIndex: number; activeDate: string | undefined; playing: boolean;
  onStep: (i: number) => void; onToggle: () => void; onLive: () => void;
}) {
  const t = useTranslations("sectorRotation");
  const locale = useLocale() as Locale;
  if (timeline.length < 2) return null;
  const atEnd = activeIndex >= timeline.length - 1;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="rotation-playback">
      <Button variant="outline" size="icon" aria-label={t("prev")} disabled={activeIndex <= 0} onClick={() => onStep(Math.max(0, activeIndex - 1))}><SkipBack /></Button>
      <Button variant="outline" size="icon" aria-label={playing ? t("pause") : t("play")} onClick={onToggle}>{playing ? <Pause /> : <Play />}</Button>
      <Button variant="outline" size="icon" aria-label={t("next")} disabled={atEnd} onClick={() => onStep(Math.min(timeline.length - 1, activeIndex + 1))}><SkipForward /></Button>
      <Slider min={0} max={timeline.length - 1} step={1} value={[activeIndex]} aria-label={t("timeline")} onValueChange={([next]) => onStep(next)} className="min-w-32 flex-1" data-testid="rotation-timeline" />
      <span className="num text-xs text-muted-foreground">{activeDate ? formatDate(activeDate, locale) : ""}</span>
      {!atEnd && <Button variant="ghost" size="sm" onClick={onLive}>{t("live")}</Button>}
    </div>
  );
}

function Insufficient({ result, required, interval }: { result: RotationResult | null; required: number; interval: RrgInterval }) {
  const t = useTranslations("sectorRotation");
  const coverage = result?.coverage ?? [];
  const available = result?.available ?? 0;
  const present = new Set(coverage.map((c) => c.sectorId));
  const missing = SECTOR_ORDER.filter((code) => !present.has(code));
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-dashed border-border p-4" data-testid="rotation-insufficient">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">{t("insufficientTitle")}</h3>
        <p className="text-sm text-muted-foreground">{t("insufficientBody", { required, available, interval: t(interval) })}</p>
        <p className="caption-style text-subtle">{t("activation", { required })}</p>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuenow={available} aria-valuemin={0} aria-valuemax={required}>
        <div className="h-full bg-primary" style={{ width: `${Math.min(100, (available / required) * 100)}%` }} />
      </div>
      {coverage.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader><TableRow interactive={false}>
              <TableHead className="h-auto px-(--spacing-cell-x) py-cell-y text-xs font-medium whitespace-normal text-muted-foreground">{t("sector")}</TableHead>
              <TableHead numeric className="h-auto px-(--spacing-cell-x) py-cell-y text-xs font-medium whitespace-normal text-muted-foreground">{t("alignedObs")}</TableHead>
              <TableHead numeric className="h-auto px-(--spacing-cell-x) py-cell-y text-xs font-medium whitespace-normal text-muted-foreground">{t("validPoints")}</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {coverage.map((c) => (
                <TableRow key={c.sectorId} className="h-row">
                  <TableCell className="px-(--spacing-cell-x)"><span className="ticker">{c.sectorId}</span> <span className="text-muted-foreground">{SECTOR_NAMES[c.sectorId] ?? ""}</span></TableCell>
                  <TableCell className="num px-(--spacing-cell-x) text-right">{c.aligned}</TableCell>
                  <TableCell className="num px-(--spacing-cell-x) text-right">{c.points}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {missing.length > 0 && (
        <p className="caption-style text-subtle" data-testid="rotation-missing-sectors">{t("missingSectors", { count: missing.length, sectors: missing.join(", ") })}</p>
      )}
      <p className="caption-style text-subtle">{t("ingestionNote")}</p>
    </section>
  );
}

function MethodologyNote() {
  const t = useTranslations("sectorRotation");
  return (
    <section className="flex flex-col gap-1 rounded-xl border border-border p-3" data-testid="rotation-methodology">
      <h3 className="text-sm font-semibold">{t("methodologyTitle")}</h3>
      <p className="text-xs text-muted-foreground">{t("methodologyBody")}</p>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-subtle">
        {QUADRANTS.map((q) => <li key={q}>{t(`quadrants.${q}`)}: {t(`quadrantHelp.${q}`)}</li>)}
      </ul>
    </section>
  );
}
