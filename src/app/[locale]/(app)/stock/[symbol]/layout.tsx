import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { StockTabsNav } from "@/components/layout/stock-tabs-nav";
import { StockHeaderLive } from "@/components/market/stock-header-live";
import { symbolSchema } from "@/server/schemas/inputs";
import { getViewer } from "@/server/viewer";

export async function generateMetadata({ params }: LayoutProps<"/[locale]/stock/[symbol]">): Promise<Metadata> {
  return { title: (await params).symbol.toUpperCase() };
}

export default async function StockLayout({ children, params }: LayoutProps<"/[locale]/stock/[symbol]">) {
  const { locale, symbol: raw } = await params;
  setRequestLocale(locale);
  const parsed = symbolSchema.safeParse(raw);
  if (!parsed.success) notFound();
  // Canonical tickers are upper-case: /id/stock/bbca → /id/stock/BBCA (same tab).
  if (parsed.data !== raw) redirect(`/${locale}/stock/${parsed.data}`);
  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-3 px-4 pt-4 md:px-6">
        <h1 data-testid="stock-symbol" className="sr-only">{parsed.data}</h1>
        <StockHeaderLive symbol={parsed.data} viewer={await getViewer()} />
        <StockTabsNav symbol={parsed.data} />
      </div>
      {children}
    </div>
  );
}
