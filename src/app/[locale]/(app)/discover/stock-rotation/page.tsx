import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { StockSectorRotationView } from "./stock-sector-rotation-view";

export async function generateMetadata({ params }: PageProps<"/[locale]/discover/stock-rotation">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "nav" });
  return { title: t("stockRotation") };
}

export default async function StockRotationPage({ params }: PageProps<"/[locale]/discover/stock-rotation">) {
  setRequestLocale((await params).locale);
  return <StockSectorRotationView />;
}
