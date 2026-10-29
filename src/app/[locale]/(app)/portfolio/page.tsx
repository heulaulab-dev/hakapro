import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getViewer } from "@/server/viewer";
import { PortfolioView } from "./portfolio-view";

export async function generateMetadata({ params }: PageProps<"/[locale]/portfolio">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "portfolio" });
  return { title: t("title") };
}
export default async function PortfolioPage({ params }: PageProps<"/[locale]/portfolio">) { setRequestLocale((await params).locale); return <PortfolioView viewer={await getViewer()} />; }
