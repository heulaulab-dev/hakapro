import { setRequestLocale } from "next-intl/server";
import { getViewer } from "@/server/viewer";
import { WatchlistView } from "./watchlist-view";

export default async function WatchlistPage({ params }: PageProps<"/[locale]/watchlist">) {
  setRequestLocale((await params).locale);
  return <WatchlistView viewer={await getViewer()} />;
}
