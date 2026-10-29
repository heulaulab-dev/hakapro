import { setRequestLocale } from "next-intl/server";
import { DividendsView } from "./dividends-view";

export default async function DividendsPage({ params }: PageProps<"/[locale]/stock/[symbol]/dividends">) {
  const { locale, symbol } = await params;
  setRequestLocale(locale);
  return <DividendsView symbol={symbol} />;
}
