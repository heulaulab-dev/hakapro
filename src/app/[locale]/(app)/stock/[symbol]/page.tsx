import { setRequestLocale } from "next-intl/server";
import { OverviewView } from "./overview-view";

export default async function StockOverviewPage({ params }: PageProps<"/[locale]/stock/[symbol]">) {
  const { locale, symbol } = await params;
  setRequestLocale(locale);
  return <OverviewView symbol={symbol} />;
}
