import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getViewer } from "@/server/viewer";
import { WatchlistView } from "./watchlist-view";

export async function generateMetadata({ params }: PageProps<"/[locale]/watchlist">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "nav" });
  return { title: t("watchlist") };
}

export default async function WatchlistPage({ params }: PageProps<"/[locale]/watchlist">) {
  setRequestLocale((await params).locale);
  return <WatchlistView viewer={await getViewer()} />;
}
