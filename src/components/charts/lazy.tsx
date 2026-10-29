"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Chart libraries are the heaviest client code (lightweight-charts ~54KB gz, recharts ~104KB gz). Loading
 * them as separate chunks after hydration lets headers, metrics and tables render and respond first on
 * slow mobile connections. The skeleton keeps the chart's height, so nothing jumps when it arrives.
 */
const chartSkeleton = (height: number) => function ChartSkeleton() {
  return <Skeleton aria-hidden className="w-full" style={{ height }} />;
};

export const PriceChart = dynamic(() => import("./price-chart").then((module) => module.PriceChart), { ssr: false, loading: chartSkeleton(320) });
export const DivergingBarChart = dynamic(() => import("./diverging-bar-chart").then((module) => module.DivergingBarChart), { ssr: false, loading: chartSkeleton(240) });
export const DivergingColumnChart = dynamic(() => import("./diverging-column-chart").then((module) => module.DivergingColumnChart), { ssr: false, loading: chartSkeleton(220) });
export const MultiLineChart = dynamic(() => import("./multi-line-chart").then((module) => module.MultiLineChart), { ssr: false, loading: chartSkeleton(260) });
export const BreadthHistoryCharts = dynamic(() => import("@/app/[locale]/(app)/discover/intelligence/breadth-history-charts").then((module) => module.BreadthHistoryCharts), { ssr: false, loading: chartSkeleton(240) });
export const SeasonalityHeatmap = dynamic(() => import("./seasonality-heatmap").then((module) => module.SeasonalityHeatmap), { ssr: false, loading: chartSkeleton(200) });
