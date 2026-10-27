"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { CartesianGrid, ReferenceArea, ReferenceLine, Scatter, ScatterChart, XAxis, YAxis, ZAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { seriesColor } from "./series";
import type { Quadrant, RrgPoint } from "@/lib/sector-rotation";

export type RrgChartSeries = { code: string; name: string; colorIndex: number; tail: RrgPoint[] };

const QUADRANT_FILL: Record<Quadrant, string> = {
  leading: "var(--positive)", weakening: "var(--warning, var(--muted-foreground))",
  improving: "var(--series-2)", lagging: "var(--negative)",
};

/** Arrowhead at the latest point, rotated along the tail's last segment; label shows the sector code. */
function arrow(colorIndex: number, angleDeg: number, code: string, dim: boolean) {
  const color = seriesColor(colorIndex);
  // eslint-disable-next-line react/display-name
  return (props: { cx?: number; cy?: number }) => {
    const { cx, cy } = props;
    if (cx == null || cy == null) return <g />;
    const s = 7;
    return (
      <g transform={`translate(${cx},${cy})`} opacity={dim ? 0.25 : 1}>
        <g transform={`rotate(${angleDeg})`}>
          <path d={`M ${s} 0 L ${-s * 0.7} ${s * 0.7} L ${-s * 0.2} 0 L ${-s * 0.7} ${-s * 0.7} Z`} fill={color} stroke="var(--card)" strokeWidth={1} />
        </g>
        <text x={9} y={-8} fontSize={11} fontWeight={600} fill="var(--foreground)" className="ticker">{code}</text>
      </g>
    );
  };
}

function dot(colorIndex: number, dim: boolean) {
  const color = seriesColor(colorIndex);
  // eslint-disable-next-line react/display-name
  return (props: { cx?: number; cy?: number; index?: number; payload?: { tailPos?: number; tailLen?: number } }) => {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null) return <g />;
    // Older points more transparent; newest tail dot is brightest (the arrow sits on top of it).
    const pos = payload?.tailPos ?? 0;
    const len = payload?.tailLen ?? 1;
    const fade = len > 1 ? 0.25 + 0.6 * (pos / (len - 1)) : 0.85;
    return <circle cx={cx} cy={cy} r={2.5} fill={color} opacity={(dim ? 0.2 : 1) * fade} />;
  };
}

/** Four-quadrant RRG scatter. `domainPad` widens the square around 100; `highlight` dims the others. */
export function RrgChart({ series, highlight, height = 420 }: { series: RrgChartSeries[]; highlight: string | null; height?: number }) {
  const t = useTranslations("sectorRotation");
  const bound = useMemo(() => {
    let max = 2;
    for (const s of series) for (const p of s.tail) max = Math.max(max, Math.abs(p.rsRatio - 100), Math.abs(p.rsMomentum - 100));
    return Math.ceil(max + 0.5);
  }, [series]);
  const lo = 100 - bound;
  const hi = 100 + bound;
  const config = Object.fromEntries(series.map((s) => [s.code, { label: s.name, color: seriesColor(s.colorIndex) }])) satisfies ChartConfig;

  return (
    <ChartContainer config={config} className="w-full" style={{ height }} role="img" aria-label={t("chartAria")}>
      <ScatterChart margin={{ top: 12, right: 16, bottom: 16, left: 4 }}>
        {/* Quadrant backgrounds (faint). */}
        <ReferenceArea x1={100} x2={hi} y1={100} y2={hi} fill={QUADRANT_FILL.leading} fillOpacity={0.06} stroke="none" />
        <ReferenceArea x1={100} x2={hi} y1={lo} y2={100} fill={QUADRANT_FILL.weakening} fillOpacity={0.06} stroke="none" />
        <ReferenceArea x1={lo} x2={100} y1={100} y2={hi} fill={QUADRANT_FILL.improving} fillOpacity={0.06} stroke="none" />
        <ReferenceArea x1={lo} x2={100} y1={lo} y2={100} fill={QUADRANT_FILL.lagging} fillOpacity={0.06} stroke="none" />
        <CartesianGrid stroke="var(--chart-grid)" />
        <ReferenceLine x={100} stroke="var(--border)" />
        <ReferenceLine y={100} stroke="var(--border)" />
        <XAxis type="number" dataKey="rsRatio" domain={[lo, hi]} allowDataOverflow tickLine={false} axisLine={false}
          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickFormatter={(v: number) => v.toFixed(1)}
          label={{ value: t("axisRatio"), position: "insideBottom", offset: -8, fill: "var(--muted-foreground)", fontSize: 11 }} />
        <YAxis type="number" dataKey="rsMomentum" domain={[lo, hi]} allowDataOverflow width={40} tickLine={false} axisLine={false}
          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickFormatter={(v: number) => v.toFixed(1)}
          label={{ value: t("axisMomentum"), angle: -90, position: "insideLeft", fill: "var(--muted-foreground)", fontSize: 11 }} />
        <ZAxis range={[20, 20]} />
        {series.map((s) => {
          const dim = highlight !== null && highlight !== s.code;
          const tail = s.tail.map((p, i) => ({ ...p, tailPos: i, tailLen: s.tail.length }));
          return (
            <Scatter key={`tail-${s.code}`} data={tail} line={{ stroke: seriesColor(s.colorIndex), strokeWidth: dim ? 1 : 1.75, strokeOpacity: dim ? 0.25 : 0.8 }}
              shape={dot(s.colorIndex, dim)} isAnimationActive={false} />
          );
        })}
        {series.map((s) => {
          const dim = highlight !== null && highlight !== s.code;
          const last = s.tail.at(-1);
          const prev = s.tail.at(-2) ?? last;
          if (!last) return null;
          // Screen Y grows downward, so negate the momentum delta for the on-screen angle.
          const angle = prev ? -(Math.atan2(last.rsMomentum - prev.rsMomentum, last.rsRatio - prev.rsRatio) * 180) / Math.PI : 0;
          return <Scatter key={`head-${s.code}`} data={[{ ...last }]} shape={arrow(s.colorIndex, angle, s.code, dim)} isAnimationActive={false} />;
        })}
      </ScatterChart>
    </ChartContainer>
  );
}
