import { setRequestLocale } from "next-intl/server";
import { HistoryView } from "./history-view";

export default async function Page({ params }: PageProps<"/[locale]/stock/[symbol]/history">) {
  const { locale, symbol } = await params;
  setRequestLocale(locale);
  return <HistoryView symbol={symbol} />;
}
