import { setRequestLocale } from "next-intl/server";
import { StrategiesView } from "./strategies-view";

export default async function StrategiesPage({ params }: PageProps<"/[locale]/discover/strategies">) {
  setRequestLocale((await params).locale);
  return <StrategiesView />;
}
