import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { RadarView } from "./radar-view";

export async function generateMetadata({ params }: PageProps<"/[locale]/discover/radar">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "nav" });
  return { title: t("radar") };
}

export default async function RadarPage({ params }: PageProps<"/[locale]/discover/radar">) {
  setRequestLocale((await params).locale);
  return <RadarView />;
}
