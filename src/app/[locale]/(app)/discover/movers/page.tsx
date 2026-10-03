import { setRequestLocale } from "next-intl/server";
import { MoversView } from "./movers-view";

export default async function MoversPage({ params }: PageProps<"/[locale]/discover/movers">) {
  setRequestLocale((await params).locale);
  return <MoversView />;
}
