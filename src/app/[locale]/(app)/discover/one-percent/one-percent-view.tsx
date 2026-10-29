"use client";

import { useState } from "react";
import { DataState } from "@/components/feedback/data-state";
import { SectionHeader } from "@/components/layout/section-header";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import { useOwnershipScreener } from "@/lib/api/hooks";
import { freshnessMeta } from "@/lib/freshness";
import { stockHref } from "@/components/layout/nav-config";
import { useTranslations } from "next-intl";

export function OnePercentView() {
  const t = useTranslations("ownershipChanges");
  const [search, setSearch] = useState("");
  const query = useOwnershipScreener();
  const needle = search.trim().toLocaleLowerCase();

  return (
    <div className="flex flex-col gap-section p-4 md:p-6" data-testid="one-percent-screener">
      <SectionHeader as="h1" title={t("screenerTitle")} description={t("screenerHint")} meta={query.data ? freshnessMeta(query.data) : undefined} />
      <DataState query={query} compact>{(env) => <>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {[[t("screenerIssuers"), env.data.issuers], [t("screenerInvestors"), env.data.investors], [t("screenerHoldings"), env.data.holdings], [t("screenerForeign"), env.data.localForeign.foreign]].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-border p-3"><div className="caption-style text-subtle">{label}</div><div className="num text-lg">{value}</div></div>)}
        </div>
        <Input aria-label={t("screenerSearch")} placeholder={t("screenerSearch")} value={search} onChange={(event) => setSearch(event.target.value)} />
        <div className="overflow-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-left"><th className="p-2">{t("screenerStock")}</th><th className="p-2">{t("screenerInvestor")}</th><th className="p-2">{t("screenerClass")}</th><th className="p-2">{t("screenerShares")}</th><th className="p-2">{t("screenerPercent")}</th></tr></thead>
            <tbody>{env.data.rows.filter((row) => !needle || `${row.symbol} ${row.issuerName ?? ""} ${row.holderName} ${row.investorType ?? ""}`.toLocaleLowerCase().includes(needle)).slice(0, 500).map((row, index) => <tr key={`${row.symbol}:${row.holderName}:${index}`} className="border-b border-border">
              <td className="p-2"><Link href={stockHref(row.symbol, "ownership")} className="text-link hover:underline">{row.symbol}</Link><div className="caption-style text-subtle">{row.issuerName}</div></td>
              <td className="p-2">{row.holderName}</td>
              <td className="p-2">{row.investorType ?? "—"}{row.localForeign ? ` · ${row.localForeign}` : " · ?"}</td>
              <td className="num p-2">{row.shares ? Number(row.shares).toLocaleString() : "—"}</td>
              <td className="num p-2">{row.percent ? `${Number(row.percent).toFixed(2)}%` : "—"}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <p className="caption-style text-subtle">{t("screenerDisclosure", { date: env.data.snapshotDate, local: env.data.localForeign.local, unknown: env.data.localForeign.unknown })}</p>
      </>}</DataState>
    </div>
  );
}
