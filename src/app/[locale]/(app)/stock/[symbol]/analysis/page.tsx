import { setRequestLocale } from "next-intl/server";
import { AnalysisView } from "./analysis-view";

export default async function AnalysisPage({ params }: PageProps<"/[locale]/stock/[symbol]/analysis">) {
  const { locale, symbol } = await params;
  setRequestLocale(locale);
  return <AnalysisView symbol={symbol} />;
}
