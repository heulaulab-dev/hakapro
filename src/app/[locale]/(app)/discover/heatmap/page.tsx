import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { HeatmapView } from "./heatmap-view";

export async function generateMetadata({ params }: PageProps<"/[locale]/discover/heatmap">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "nav" });
  return { title: t("heatmap") };
}

export default async function HeatmapPage({ params }: PageProps<"/[locale]/discover/heatmap">) {
  setRequestLocale((await params).locale);
  return <HeatmapView />;
}
