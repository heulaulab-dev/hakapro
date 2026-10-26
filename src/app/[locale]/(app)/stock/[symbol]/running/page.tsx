import { setRequestLocale } from "next-intl/server";
import { RunningTradeView } from "./running-view";

export default async function RunningTradePage({ params }: PageProps<"/[locale]/stock/[symbol]/running">) {
  const { locale, symbol } = await params;
  setRequestLocale(locale);
  return <RunningTradeView symbol={symbol} />;
}
