import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DailyFeedView } from "./feed-view";

export async function generateMetadata({ params }: PageProps<"/[locale]/discover/feed">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "dailyFeed" });
  return { title: t("title") };
}

export default async function DailyFeedPage({ params }: PageProps<"/[locale]/discover/feed">) {
  setRequestLocale((await params).locale);
  return <DailyFeedView />;
}
