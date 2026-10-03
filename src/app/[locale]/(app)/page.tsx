import { setRequestLocale } from "next-intl/server";
import { getViewer } from "@/server/viewer";
import { HomeView } from "./home-view";

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  setRequestLocale((await params).locale);
  return <HomeView viewer={await getViewer()} />;
}
