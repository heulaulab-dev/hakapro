import { setRequestLocale } from "next-intl/server";
import { StockOwnershipView } from "./ownership-view";

export default async function Page({ params }: PageProps<"/[locale]/stock/[symbol]/ownership">) {
  const { locale, symbol } = await params;
  setRequestLocale(locale);
  return <StockOwnershipView symbol={symbol} />;
}
