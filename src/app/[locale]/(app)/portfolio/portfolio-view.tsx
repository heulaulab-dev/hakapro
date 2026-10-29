"use client";

import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { EmptyState } from "@/components/feedback/empty-state";
import { SectionHeader } from "@/components/layout/section-header";
import type { ViewerSummary } from "@/components/layout/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Link } from "@/i18n/navigation";
import { useQuotes } from "@/lib/api/hooks";
import { usePortfolio, usePortfolioMutations } from "@/lib/portfolio-query";
import { summarizePortfolio } from "@/lib/portfolio";
import { formatDate, formatIdr, formatNumber, type Locale } from "@/lib/format";

export function PortfolioView({ viewer }: { viewer: ViewerSummary }) {
  const t = useTranslations("portfolio");
  const locale = useLocale() as Locale;
  const [symbol, setSymbol] = useState("");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [transactionType, setTransactionType] = useState<"BUY" | "SELL">("BUY");
  const [message, setMessage] = useState<string | null>(null);
  const portfolio = usePortfolio(viewer.kind === "user");
  const { add, remove } = usePortfolioMutations();
  const transactions = portfolio.data?.transactions ?? [];
  const lots = summarizePortfolio(transactions);
  const quotes = useQuotes(lots.map((lot) => lot.symbol));
  const quoteMap = new Map((quotes.data?.data ?? []).filter((quote) => quote.status === "ok").map((quote) => [quote.symbol, quote]));
  const totalCost = lots.reduce((sum, lot) => sum + lot.cost, 0);
  const priced = lots.every((lot) => quoteMap.has(lot.symbol));
  const totalValue = priced ? lots.reduce((sum, lot) => sum + lot.quantity * quoteMap.get(lot.symbol)!.close, 0) : null;

  if (viewer.kind !== "user") return <div className="flex flex-col gap-section p-4 md:p-6"><SectionHeader as="h1" title={t("title")} description={t("intro")} /><EmptyState title={t("signIn")} action={<Button asChild size="sm"><Link href="/login?next=%2Fportfolio">{t("signInAction")}</Link></Button>} /></div>;

  function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    const code = symbol.trim().toUpperCase();
    const qty = Number(quantity);
    const px = Number(price);
    if (!/^[A-Z0-9]{1,12}$/.test(code) || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(px) || px < 0) return setMessage(t("invalid"));
    add.mutate({ symbol: code, transactionType, transactionDate: new Date().toISOString().slice(0, 10), quantity: qty, price: px }, { onSuccess: () => { setSymbol(""); setQuantity(""); setPrice(""); }, onError: () => setMessage(t("failed")) });
  }

  return <div className="flex flex-col gap-section p-4 md:p-6" data-testid="portfolio-view">
    <SectionHeader as="h1" title={t("title")} description={t("intro")} />
    <form onSubmit={submit} className="grid max-w-3xl gap-2 sm:grid-cols-[auto_1fr_1fr_1fr_auto]">
      <ToggleGroup type="single" size="sm" variant="outline" value={transactionType} onValueChange={(value) => value && setTransactionType(value as "BUY" | "SELL")} aria-label={t("type")}><ToggleGroupItem value="BUY">{t("buy")}</ToggleGroupItem><ToggleGroupItem value="SELL">{t("sell")}</ToggleGroupItem></ToggleGroup>
      <Input value={symbol} onChange={(event) => setSymbol(event.target.value)} placeholder={t("symbol")} aria-label={t("symbol")} className="ticker uppercase" />
      <Input value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder={t("quantity")} aria-label={t("quantity")} inputMode="decimal" />
      <Input value={price} onChange={(event) => setPrice(event.target.value)} placeholder={t("price")} aria-label={t("price")} inputMode="decimal" />
      <Button type="submit" disabled={add.isPending}>{t("add")}</Button>
    </form>
    {message && <p role="alert" className="text-xs text-negative">{message}</p>}
    {portfolio.isError && <p role="alert" className="text-xs text-negative">{t("failed")}</p>}
    <div className="grid gap-3 sm:grid-cols-3">
      <Metric label={t("cost")} value={formatIdr(totalCost, locale, { compact: true })} />
      <Metric label={t("value")} value={totalValue === null ? "—" : formatIdr(totalValue, locale, { compact: true })} />
      <Metric label={t("pnl")} value={totalValue === null ? "—" : formatIdr(totalValue - totalCost, locale, { compact: true })} />
    </div>
    {portfolio.isPending ? <p role="status">{t("loading")}</p> : lots.length === 0 ? <EmptyState title={t("empty")} /> : <div className="overflow-x-auto rounded-xl border border-border"><table className="w-full min-w-[38rem] text-xs"><thead><tr className="border-b border-border text-left text-muted-foreground"><th className="p-3">{t("stock")}</th><th className="p-3 text-right">{t("quantity")}</th><th className="p-3 text-right">{t("average")}</th><th className="p-3 text-right">{t("last")}</th><th className="p-3 text-right">{t("pnl")}</th></tr></thead><tbody>{lots.map((lot) => { const last = quoteMap.get(lot.symbol)?.close ?? null; return <tr key={lot.symbol} className="border-b border-border last:border-0"><td className="p-3 ticker">{lot.symbol}</td><td className="p-3 text-right num">{formatNumber(lot.quantity, locale)}</td><td className="p-3 text-right num">{formatIdr(lot.averagePrice, locale)}</td><td className="p-3 text-right num">{last === null ? "—" : formatIdr(last, locale)}</td><td className="p-3 text-right num">{last === null ? "—" : formatIdr((last - lot.averagePrice) * lot.quantity, locale)}</td></tr>; })}</tbody></table></div>}
    {transactions.length > 0 && <section className="space-y-2"><h2 className="text-sm font-semibold">{t("transactions")}</h2><ul className="divide-y divide-border rounded-xl border border-border">{transactions.map((tx) => <li key={tx.id} className="flex flex-wrap items-center gap-2 p-3 text-xs"><span className="ticker">{tx.symbol}</span><span>{t(tx.transactionType === "BUY" ? "buy" : "sell")}</span><span>{formatNumber(tx.quantity, locale)} × {formatIdr(tx.price, locale)}</span><span className="text-muted-foreground">{formatDate(tx.transactionDate, locale)}</span><button type="button" className="ml-auto text-muted-foreground hover:text-foreground" disabled={remove.isPending} onClick={() => remove.mutate(tx.id, { onError: () => setMessage(t("failed")) })}>{t("remove")}</button></li>)}</ul></section>}
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-border p-4"><div className="caption-style text-muted-foreground">{label}</div><div className="num mt-1 text-lg font-semibold">{value}</div></div>; }
