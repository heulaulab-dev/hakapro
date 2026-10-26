import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { StockChrome } from "@/components/market/stock-chrome";
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
      <h1 data-testid="stock-symbol" className="sr-only">{parsed.data}</h1>
      <StockChrome symbol={parsed.data} viewer={await getViewer()} />
      {children}
    </div>
  );
}
