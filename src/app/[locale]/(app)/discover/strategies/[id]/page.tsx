import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { StrategyDetailView } from "./strategy-detail-view";

export default async function StrategyPage({ params }: PageProps<"/[locale]/discover/strategies/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  if (!/^[a-z0-9-]{1,80}$/.test(id)) notFound();
  return <StrategyDetailView id={id} />;
}
