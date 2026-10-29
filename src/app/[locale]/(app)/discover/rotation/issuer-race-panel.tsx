"use client";

import { Pause, Play, SkipBack, SkipForward } from "@/components/kit/icons";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { DataState } from "@/components/feedback/data-state";
import { SectionHeader } from "@/components/layout/section-header";
import { Segmented } from "@/components/kit/segmented";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useIssuerRace } from "@/lib/api/hooks";
import type { IssuerRace } from "@/lib/api/market";
import { formatDate, type Locale } from "@/lib/format";
import { freshnessMeta, type FreshnessMeta } from "@/lib/freshness";
import { Link } from "@/i18n/navigation";
import { stockHref } from "@/components/layout/nav-config";

const WINDOWS = ["1M", "3M", "6M", "1Y"] as const;
type Window = (typeof WINDOWS)[number];

export function IssuerRacePanel() {
  const [window, setWindow] = useState<Window>("3M");
  const [sector, setSector] = useState("all");
  const query = useIssuerRace(window, sector);

  const changeWindow = (value: Window) => { setWindow(value); };
  const changeSector = (value: string) => { setSector(value); };

  return (
    <DataState query={query} compact>
      {(envelope) => <IssuerRaceWorkspace key={`${window}-${sector}`} data={envelope.data} meta={freshnessMeta(envelope)} window={window} sector={sector} onWindow={changeWindow} onSector={changeSector} />}
    </DataState>
  );
}

function IssuerRaceWorkspace({ data, meta, window, sector, onWindow, onSector }: {
  data: IssuerRace; meta: FreshnessMeta; window: Window; sector: string; onWindow: (value: Window) => void; onSector: (value: string) => void;
}) {
  const t = useTranslations("sectorRotation");
  const locale = useLocale() as Locale;
  const [activeIndex, setActiveIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = globalThis.window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (reducedMotion || !playing || data.frames.length < 2) return;
    const id = setInterval(() => setActiveIndex((index) => {
      if (index >= data.frames.length - 1) { setPlaying(false); return data.frames.length - 1; }
      return index + 1;
    }), 750);
    return () => clearInterval(id);
  }, [playing, reducedMotion, data.frames.length]);

  const frame = data.frames[Math.min(activeIndex, data.frames.length - 1)];
  const leaders = frame?.leaders ?? [];
  const scale = Math.max(1, ...leaders.map((leader) => Math.abs(leader.returnPercent)));
  const setStep = (step: number) => {
    setPlaying(false);
    setActiveIndex((index) => Math.max(0, Math.min(data.frames.length - 1, index + step)));
  };

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 md:p-4" data-testid="issuer-race">
      <SectionHeader as="h2" title={t("raceTitle")} description={t("raceDescription")} meta={meta} actions={
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1 text-xs text-muted-foreground"><span>{t("raceWindow")}</span>
            <Segmented value={window} onChange={(value) => onWindow(value as Window)} options={WINDOWS.map((value) => ({ value, label: value }))} />
          </div>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">{t("sector")}
            <Select value={sector} onValueChange={onSector}>
              <SelectTrigger className="h-8 min-w-40 text-sm" data-testid="issuer-race-sector"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allSectors")}</SelectItem>
                {data.sectors.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
        </div>
      } />

      {frame ? <>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" data-testid="issuer-race-coverage">
          <span>{t("raceAsOf", { date: formatDate(frame.date, locale) })}</span>
          <span>{t("raceCoverage", { priced: frame.priced, baseline: data.universe.withBaseline, active: data.universe.active })}</span>
          {data.universe.truncated && <span className="text-(--tag-amber-text)">{t("raceTruncated")}</span>}
          <span>{t("raceSource")}</span>
        </div>
        <ol className="flex flex-col gap-2" aria-label={t("raceLeaders")}>
          {leaders.map((leader, index) => {
            const width = `${Math.min(100, Math.abs(leader.returnPercent) / scale * 100)}%`;
            const positive = leader.returnPercent >= 0;
            return (
              <li key={leader.symbol} className="grid grid-cols-[2rem_minmax(4.5rem,7rem)_minmax(5rem,1fr)_4.5rem] items-center gap-2 rounded-md px-1 py-0.5" data-testid={`issuer-race-row-${leader.symbol}`}>
                <span className="num text-right text-xs text-faint">{String(index + 1).padStart(2, "0")}</span>
                <Link href={stockHref(leader.symbol)} className="ticker text-sm font-semibold text-link hover:underline">{leader.symbol}</Link>
                <span className="relative h-5 overflow-hidden rounded bg-secondary" aria-hidden="true">
                  <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
                  <span className={`absolute inset-y-0 ${positive ? "left-1/2 bg-(--tag-green-bg)" : "right-1/2 bg-(--tag-red-bg)"} ${reducedMotion ? "" : "transition-[width] duration-500 ease-out"}`} style={{ width }} />
                </span>
                <span className={`num text-right text-sm font-semibold ${positive ? "text-(--tag-green-text)" : "text-(--tag-red-text)"}`}>{positive ? "+" : ""}{leader.returnPercent.toFixed(1)}%</span>
              </li>
            );
          })}
        </ol>
        <div className="flex items-center gap-2 border-t border-border pt-2" data-testid="issuer-race-playback">
          <Button variant="ghost" size="icon-sm" aria-label={t("prev")} disabled={activeIndex <= 0} onClick={() => setStep(-1)}><SkipBack /></Button>
          {!reducedMotion && <Button variant="outline" size="sm" onClick={() => setPlaying((value) => !value)}>{playing ? <Pause /> : <Play />}{playing ? t("pause") : t("play")}</Button>}
          <Button variant="ghost" size="icon-sm" aria-label={t("next")} disabled={activeIndex >= data.frames.length - 1} onClick={() => setStep(1)}><SkipForward /></Button>
          <Slider value={[activeIndex]} min={0} max={Math.max(0, data.frames.length - 1)} step={1} aria-label={t("raceTimeline")} onValueChange={([value]) => { setPlaying(false); setActiveIndex(value); }} className="mx-2" />
          <span className="num min-w-24 text-right text-xs text-muted-foreground">{data.from ? formatDate(data.from, locale) : "—"} – {data.to ? formatDate(data.to, locale) : "—"}</span>
        </div>
      </> : <p className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted-foreground">{t("raceNoData")}</p>}
      <p className="caption-style text-faint">{t("raceMethodology")}</p>
    </section>
  );
}
