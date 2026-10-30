"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { DataState } from "@/components/feedback/data-state";
import { SectionHeader } from "@/components/layout/section-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { stockHref } from "@/components/layout/nav-config";
import { useOwnershipNetwork } from "@/lib/api/hooks";
import { freshnessMeta } from "@/lib/freshness";

const PAGE_SIZE = 100;
const changeLabels: Record<string, string> = { NEW: "newlyDisclosed", INCREASE: "increased", DECREASE: "decreased", EXIT: "reportedExit", UNCHANGED: "unchanged", BELOW_THRESHOLD: "belowThreshold", AMBIGUOUS: "ambiguousChange" };
const formatShares = (value: string | null, locale: string) => {
  if (!value) return "—";
  try { return BigInt(value).toLocaleString(locale); } catch { return "—"; }
};

export function InvestorNetworkView() {
  const t = useTranslations("ownershipNetworkReplay");
  const locale = useLocale();
  const [month, setMonth] = useState<string>();
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"holder" | "issuer" | "percent">("holder");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);
  const numberFormat = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const percentFormat = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }), [locale]);
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "Asia/Jakarta" }), [locale]);
  const query = useOwnershipNetwork(month);
  const selected = query.data?.data.month ?? undefined;
  const needle = search.trim().toLocaleLowerCase();

  return <div className="flex flex-col gap-section p-4 md:p-6" data-testid="investor-network-replay">
    <SectionHeader as="h1" title={t("title")} description={t("description")} meta={query.data ? freshnessMeta(query.data) : undefined} />
    <DataState query={query} compact>{(env) => {
      const data = env.data;
      const filtered = data.rows.filter((row) => !needle || `${row.symbol} ${row.issuerName ?? ""} ${row.holderName} ${row.investorType ?? ""}`.toLocaleLowerCase().includes(needle));
      const sorted = [...filtered].sort((a, b) => {
        const comparison = sortBy === "percent"
          ? Number(a.percent ?? -1) - Number(b.percent ?? -1)
          : (sortBy === "issuer" ? `${a.symbol} ${a.issuerName ?? ""}` : a.holderName).localeCompare(sortBy === "issuer" ? `${b.symbol} ${b.issuerName ?? ""}` : b.holderName, locale, { sensitivity: "base", numeric: true });
        return sortDirection === "asc" ? comparison : -comparison;
      });
      const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
      const visibleRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
      const fromRow = sorted.length ? page * PAGE_SIZE + 1 : 0;
      const toRow = Math.min((page + 1) * PAGE_SIZE, sorted.length);
      const graphEdges = data.network.edges.slice(0, 36);
      const holders = [...new Set(graphEdges.map((edge) => edge.from))];
      const issuers = [...new Set(graphEdges.map((edge) => edge.to))];
      const holderLabels = new Map(data.network.nodes.map((node) => [node.id, node.label]));
      const issuerDates = new Map(data.issuerRecords.map((record) => [record.symbol, record.snapshotDate]));
      const uniqueDates = [...new Set(data.issuerRecords.map((record) => record.snapshotDate))].sort();
      const formatDate = (date: string) => dateFormat.format(new Date(`${date}T12:00:00+07:00`));
      const comparisonLabel = data.comparison.status === "COMPARED" ? t("compared", { month: data.comparison.fromMonth ?? "" }) : data.comparison.status === "NOT_ADJACENT" ? t("gap") : data.comparison.status === "NO_PREVIOUS" ? t("noPrevious") : t("notCompared");
      return <>
        {data.availability === "DISABLED" && <div role="status" className="rounded-xl border border-border p-4 text-sm">{t("disabled")}</div>}
        {data.availability === "ENABLED" && !data.month && <div role="status" className="rounded-xl border border-border p-4 text-sm">{t("empty")}</div>}
        {data.month && <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3">
            <div><p className="text-sm font-semibold">{t("snapshot", { date: data.snapshotDate ? formatDate(data.snapshotDate) : "—" })}</p>{uniqueDates.length > 1 && <p className="caption-style text-subtle">{t("mixedDates", { from: formatDate(uniqueDates[0]!), to: formatDate(uniqueDates.at(-1)!) })}</p>}<p className="caption-style text-subtle">{t("personal")}</p></div>
            <Select value={selected} onValueChange={(value) => { setMonth(value); setSearch(""); setPage(0); }}>
              <SelectTrigger className="h-9 w-44" aria-label={t("monthLabel")} data-testid="investor-network-month"><SelectValue /></SelectTrigger>
              <SelectContent>{data.months.map((availableMonth) => <SelectItem key={availableMonth} value={availableMonth}>{availableMonth}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {[[t("issuers"), data.issuers], [t("positions"), data.holdings], [t("matched"), data.network.edges.length], [t("ambiguous"), data.network.ambiguous]].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-border p-3"><div className="caption-style text-subtle">{label}</div><div className="num text-lg">{value}</div></div>)}
          </div>
          <section className="space-y-3 rounded-xl border border-border p-4">
            <div><h2 className="h2-style">{t("networkTitle")}</h2><p className="caption-style text-subtle">{t("networkHint", { count: graphEdges.length, total: data.network.edges.length })}</p></div>
            {graphEdges.length ? <div className="overflow-x-auto"><svg viewBox="0 0 900 420" role="img" aria-label={t("networkTitle")} className="min-w-[600px] w-full">
              {graphEdges.map((edge) => { const from = holders.indexOf(edge.from), to = issuers.indexOf(edge.to); const x1 = 160, x2 = 740; const y1 = 28 + (from + .5) * (360 / Math.max(holders.length, 1)); const y2 = 28 + (to + .5) * (360 / Math.max(issuers.length, 1)); return <g key={`${edge.from}-${edge.to}-${edge.sourceReference}`}><line x1={x1 + 8} y1={y1} x2={x2 - 8} y2={y2} stroke="currentColor" strokeOpacity=".28" /><text x="440" y={(y1 + y2) / 2 - 3} textAnchor="middle" fontSize="11" fill="currentColor">{edge.percent ? `${percentFormat.format(Number(edge.percent))}%` : "≥1%"}</text></g>; })}
              {holders.map((id, index) => <g key={id}><circle cx="160" cy={28 + (index + .5) * (360 / Math.max(holders.length, 1))} r="7" fill="var(--color-chart-2, #60a5fa)" /><text x="145" y={32 + (index + .5) * (360 / Math.max(holders.length, 1))} textAnchor="end" fontSize="12" fill="currentColor">{(holderLabels.get(id) ?? id).slice(0, 20)}</text></g>)}
              {issuers.map((id, index) => { const symbol = id.replace("issuer:", ""); return <g key={id}><circle cx="740" cy={28 + (index + .5) * (360 / Math.max(issuers.length, 1))} r="8" fill="var(--color-chart-1, #fbbf24)" /><text x="755" y={32 + (index + .5) * (360 / Math.max(issuers.length, 1))} fontSize="12" fill="currentColor">{symbol}</text></g>; })}
            </svg></div> : <p className="text-sm text-subtle">{t("noEdges")}</p>}
            {graphEdges.length > 0 && <details className="rounded-lg bg-secondary p-3"><summary className="cursor-pointer text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{t("graphDetails")}</summary><ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">{graphEdges.map((edge) => { const symbol = edge.to.replace("issuer:", ""); return <li key={`${edge.from}-${edge.to}-${edge.sourceReference}`}><Link className="text-link hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" href={stockHref(symbol, "ownership")}>{holderLabels.get(edge.from) ?? edge.from} → {symbol}{edge.percent ? ` · ${percentFormat.format(Number(edge.percent))}%` : ""} · {issuerDates.get(symbol) ?? "—"} · {edge.sourceReference}</Link></li>; })}</ul></details>}
            <p className="caption-style text-subtle">{t("exactMatch", { ambiguous: data.network.ambiguous })}</p>
          </section>
          <section className="space-y-3 rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="h2-style">{t("comparisonTitle")}</h2><p className="caption-style text-subtle">{comparisonLabel}</p></div><span className="caption-style text-subtle">{t("comparedIssuers", { count: data.comparison.comparedIssuers })}</span></div>
            <div className="flex flex-wrap gap-2 text-xs text-subtle">{Object.entries(data.comparison.statusCounts).map(([status, count]) => <span key={status} className="rounded-md bg-secondary px-2 py-1">{t(`status${status}` as "statusCOMPARED", { count })}</span>)}</div>
            {data.comparison.comparedIssuers > 0 ? <div className="grid grid-cols-2 gap-2 md:grid-cols-4">{Object.entries(data.comparison.counts).map(([kind, count]) => <div key={kind} className="rounded-lg bg-secondary p-2"><div className="caption-style text-subtle">{t(changeLabels[kind] as "newlyDisclosed")}</div><div className="num">{count}</div></div>)}</div> : <p className="text-sm text-subtle">{t("noComparisonCounts", { count: data.comparison.statusCounts.NO_PREVIOUS + data.comparison.statusCounts.NOT_ADJACENT + data.comparison.statusCounts.REFUSED })}</p>}
          </section>
          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="h2-style">{t("positionsTitle")}</h2><p className="caption-style text-subtle">{t("rowsShown", { from: numberFormat.format(fromRow), to: numberFormat.format(toRow), total: numberFormat.format(data.rows.length) })}</p></div><div className="flex flex-wrap gap-2"><Input className="max-w-sm" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} aria-label={t("search")} placeholder={t("search")} /><Select value={sortBy} onValueChange={(value) => { setSortBy(value as typeof sortBy); setPage(0); }}><SelectTrigger className="w-40" aria-label={t("sortBy")}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="holder">{t("sortHolder")}</SelectItem><SelectItem value="issuer">{t("sortIssuer")}</SelectItem><SelectItem value="percent">{t("sortPercent")}</SelectItem></SelectContent></Select><Button variant="outline" size="sm" aria-label={t(sortDirection === "asc" ? "sortDescending" : "sortAscending")} onClick={() => { setSortDirection(sortDirection === "asc" ? "desc" : "asc"); setPage(0); }}>{sortDirection === "asc" ? t("ascending") : t("descending")}</Button></div></div>
            <div className="max-h-[65vh] overflow-auto rounded-xl border border-border"><table className="w-full text-sm"><thead className="sticky top-0 bg-secondary"><tr className="text-left"><th className="p-2">{t("issuer")}</th><th className="p-2">{t("asOf")}</th><th className="p-2">{t("holder")}</th><th className="p-2">{t("classification")}</th><th className="p-2">{t("shares")}</th><th className="p-2">{t("percent")}</th><th className="p-2">{t("source")}</th></tr></thead><tbody>{visibleRows.map((row, index) => <tr className="border-t border-border" key={`${row.symbol}:${row.reference}:${page * PAGE_SIZE + index}`}><td className="p-2"><Link href={stockHref(row.symbol, "ownership")} className="text-link hover:underline">{row.symbol}</Link><div className="caption-style text-subtle">{row.issuerName}</div></td><td className="p-2 text-xs text-subtle">{issuerDates.get(row.symbol) ? formatDate(issuerDates.get(row.symbol)!) : "—"}</td><td className="p-2">{row.holderName}</td><td className="p-2">{row.investorType ?? row.holderKind}{row.localForeign ? ` · ${row.localForeign}` : ""}</td><td className="num p-2">{formatShares(row.shares, locale)}</td><td className="num p-2">{row.percent ? `${percentFormat.format(Number(row.percent))}%` : "—"}</td><td className="p-2 text-xs text-subtle">{row.reference}</td></tr>)}</tbody></table></div>
            <div className="flex items-center justify-between gap-3"><Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(Math.max(0, page - 1))}>{t("previousPage")}</Button><span className="caption-style text-subtle">{t("pageOf", { page: page + 1, pages: pageCount })}</span><Button variant="outline" size="sm" disabled={page + 1 >= pageCount} onClick={() => setPage(Math.min(pageCount - 1, page + 1))}>{t("nextPage")}</Button></div>
          </section>
          <p className="caption-style text-subtle">{t("disclaimer")}</p>
        </>}
      </>;
    }}</DataState>
  </div>;
}
