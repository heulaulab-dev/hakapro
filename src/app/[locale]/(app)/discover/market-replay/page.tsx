import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { MarketReplayView } from "./market-replay-view";

export async function generateMetadata({ params }: PageProps<"/[locale]/discover/market-replay">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "nav" });
  return { title: t("marketReplay") };
}

export default async function MarketReplayPage({ params }: PageProps<"/[locale]/discover/market-replay">) {
  setRequestLocale((await params).locale);
  return <MarketReplayView />;
}
