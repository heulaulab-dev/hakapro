import { setRequestLocale } from "next-intl/server";
import { getViewer } from "@/server/viewer";
import { ScreenerView } from "./screener-view";

export default async function ScreenerPage({ params }: PageProps<"/[locale]/discover/screener">) {
  setRequestLocale((await params).locale);
  return <ScreenerView viewer={await getViewer()} />;
}
