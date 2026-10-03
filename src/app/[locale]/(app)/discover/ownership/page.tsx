import { setRequestLocale } from "next-intl/server";
import { getViewer } from "@/server/viewer";
import { OwnershipView } from "./ownership-view";

export default async function OwnershipChangesPage({ params }: PageProps<"/[locale]/discover/ownership">) {
  setRequestLocale((await params).locale);
  return <OwnershipView viewer={await getViewer()} />;
}
