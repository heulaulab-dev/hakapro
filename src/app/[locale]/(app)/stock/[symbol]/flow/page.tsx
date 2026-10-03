import { setRequestLocale } from "next-intl/server";
import { FlowView } from "./flow-view";

export default async function FlowPage({ params }: PageProps<"/[locale]/stock/[symbol]/flow">) {
  const { locale, symbol } = await params;
  setRequestLocale(locale);
  return <FlowView symbol={symbol} />;
}
