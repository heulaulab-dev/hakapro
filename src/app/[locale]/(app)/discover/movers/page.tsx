import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { MoversView } from "./movers-view";

export async function generateMetadata({ params }: PageProps<"/[locale]/discover/movers">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "nav" });
  return { title: t("movers") };
}

export default async function MoversPage({ params }: PageProps<"/[locale]/discover/movers">) {
  setRequestLocale((await params).locale);
  return <MoversView />;
}
