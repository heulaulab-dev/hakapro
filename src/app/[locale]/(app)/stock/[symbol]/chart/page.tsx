import { setRequestLocale } from "next-intl/server";
import { ChartView } from "./chart-view";

export default async function Page({ params }: PageProps<"/[locale]/stock/[symbol]/chart">) {
  const { locale, symbol } = await params;
  setRequestLocale(locale);
  return <ChartView symbol={symbol} />;
}
