import { setRequestLocale } from "next-intl/server";
import { NewsView } from "./news-view";

export default async function NewsPage({ params }: PageProps<"/[locale]/news">) {
  setRequestLocale((await params).locale);
  return <NewsView />;
}
