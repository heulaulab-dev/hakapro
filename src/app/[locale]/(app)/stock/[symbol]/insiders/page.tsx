import { setRequestLocale } from "next-intl/server";
import { InsidersView } from "./insiders-view";

export default async function Page({ params }: PageProps<"/[locale]/stock/[symbol]/insiders">) {
  const { locale, symbol } = await params;
  setRequestLocale(locale);
  return <InsidersView symbol={symbol} />;
}
