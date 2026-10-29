import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { BrokerActivityView } from "./broker-activity-view";

export async function generateMetadata({ params }: PageProps<"/[locale]/discover/broker-activity">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "nav" });
  return { title: t("brokerActivity") };
}

export default async function BrokerActivityPage({ params }: PageProps<"/[locale]/discover/broker-activity">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "00";
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  return <BrokerActivityView today={today} />;
}
