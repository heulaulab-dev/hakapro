import { setRequestLocale } from "next-intl/server";
import { FinancialsView } from "./financials-view";

export default async function FinancialsPage({ params }: PageProps<"/[locale]/stock/[symbol]/financials">) {
  const { locale, symbol } = await params;
  setRequestLocale(locale);
  return <FinancialsView symbol={symbol} />;
}
