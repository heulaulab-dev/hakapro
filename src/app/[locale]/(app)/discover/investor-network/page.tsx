import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { InvestorNetworkView } from "./investor-network-view";

export async function generateMetadata({ params }: PageProps<"/[locale]/discover/investor-network">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "nav" });
  return { title: t("investorNetwork") };
}

export default async function InvestorNetworkPage({ params }: PageProps<"/[locale]/discover/investor-network">) {
  setRequestLocale((await params).locale);
  return <InvestorNetworkView />;
}
