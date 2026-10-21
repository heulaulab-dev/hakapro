"use client";

import { AlertTriangle, ArrowLeft, CalendarClock, Database, SearchX } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { DataState } from "@/components/feedback/data-state";
import { EmptyState } from "@/components/feedback/empty-state";
import { ResearchDisclaimer } from "@/components/feedback/research-disclaimer";
import { StatusBadge, type StatusTone } from "@/components/feedback/status-badge";
import { stockHref } from "@/components/layout/nav-config";
import { Panel } from "@/components/layout/panel";
import { ChangeValue } from "@/components/market/change-value";
import { StockHeader } from "@/components/market/stock-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "@/i18n/navigation";
import { ApiError } from "@/lib/api/envelope";
import { useResearchBrief } from "@/lib/api/hooks";
import { ResearchUnavailableError, type BriefComponent, type ComponentKey, type ResearchBrief } from "@/lib/api/research";
import { formatDate, formatIdr, formatNumber, formatPercent, formatVolume, type Locale } from "@/lib/format";

const STATUS_TONE: Record<BriefComponent["status"], StatusTone> = { ok: "info", stale: "warning", missing: "neutral" };
/** Reasons owned by the brief; provider error codes reuse the shared data-state wording. */
const BRIEF_REASONS = new Set(["NOT_AVAILABLE", "NO_CATEGORY_BREAKDOWN", "INSUFFICIENT_HISTORY"]);
const PROVIDER_REASONS = new Set(["NOT_RECORDED", "UNSUPPORTED", "NOT_CONFIGURED", "RATE_LIMITED", "PROVIDER_UNAVAILABLE", "PROVIDER_UNAUTHORIZED", "MALFORMED_PROVIDER_RESPONSE", "INVALID_REQUEST"]);

const num = (raw: BriefComponent["raw"], key: string): number | null => (typeof raw[key] === "number" ? (raw[key] as number) : null);
const str = (raw: BriefComponent["raw"], key: string): string | null => (typeof raw[key] === "string" ? (raw[key] as string) : null);

const th = "caption-style h-[38px] border-b border-border px-3 font-normal whitespace-nowrap text-subtle";
const td = "border-b border-border px-3 py-cell-y";

/** Research Brief (spec §3.4): evidence for and against, every figure with its source and as-of date. */
export function ResearchView({ code }: { code: string }) {
  const t = useTranslations("research");
  const query = useResearchBrief(code);

  if (query.isError && query.error instanceof ResearchUnavailableError) {
    const missing = query.error.missing;
    return (
      <Shell code={code}>
        <EmptyState icon={<Database />} title={t("errors.unavailable")} description={
          <span data-testid="research-missing">{t("errors.unavailableDescription", { list: missing.map((key) => (key === "price" ? t("errors.price") : isComponent(key) ? t(`components.${key}`) : key)).join(", ") })}</span>
        } />
      </Shell>
    );
  }
  if (query.isError && query.error instanceof ApiError && query.error.status === 404) {
    return (
      <Shell code={code}>
        <EmptyState icon={<SearchX />} title={t("errors.notFound")} description={t("errors.notFoundDescription", { code })} />
      </Shell>
    );
  }
  return (
    <Shell code={code}>
      <DataState query={query} skeleton={<Skeleton className="h-64 w-full" />}>
        {(brief) => <Brief brief={brief} />}
      </DataState>
    </Shell>
  );
}

const KEYS: readonly ComponentKey[] = ["momentum", "foreign", "broker", "ksei", "insider", "volume"];
const isComponent = (key: string): key is ComponentKey => (KEYS as readonly string[]).includes(key);

function Shell({ code, children }: { code: string; children: ReactNode }) {
  const t = useTranslations("research");
  return (
    <div className="flex flex-col gap-section p-4 md:p-6" data-testid="research-view">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="h2-style">{t("title")} <span className="ticker">{code}</span></h1>
        <Button variant="ghost" size="sm" asChild>
          <Link href={stockHref(code)} data-testid="research-stock-link"><ArrowLeft />{t("openStock")}</Link>
        </Button>
      </div>
      {children}
    </div>
  );
}

function Brief({ brief }: { brief: ResearchBrief }) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const component = (key: ComponentKey) => brief.components.find((item) => item.key === key)!;
  const reason = (item: BriefComponent) => reasonText(item, t);
  const ok = brief.components.filter((item) => item.status === "ok").length;

  return (
    <>
      {/* 1. Header: price exactly as the stock page shows it, with a prominent as-of stamp. */}
      <section className="flex flex-col gap-3" data-testid="research-header">
        <StockHeader symbol={brief.code} name={brief.name} price={brief.price.last} change={brief.price.change} changePercent={brief.price.changePct} meta={brief.price.meta}
          note={brief.sector ? t("research.sector", { sector: brief.sector }) : undefined} />
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm" data-testid="research-asof">
          <CalendarClock className="size-4 text-icon" />
          <span className="num font-medium">{t("research.asOf", { date: formatDate(brief.asOf, locale) })}</span>
          <StatusBadge tone={brief.freshness === "fresh" ? "info" : "warning"} data-testid="research-freshness" data-freshness={brief.freshness}>{t(`research.briefFreshness.${brief.freshness}`)}</StatusBadge>
          <span className="caption-style num text-subtle">{t("research.generatedAt", { date: formatDate(brief.generatedAt, locale) })}</span>
        </div>
        {brief.freshness !== "fresh" && <p className="caption-style text-warning">{t("research.staleNote", { date: formatDate(brief.price.session, locale) })}</p>}
      </section>

      {/* 2. Signal summary: no score yet, only completeness. */}
      <Panel title={t("research.summary.title")} testId="research-summary" description={t("research.summary.noScore")}>
        <p className="text-sm" data-testid="research-confidence">
          {t("research.summary.confidence", { ok, total: brief.components.length, pct: formatPercent(brief.score.confidence * 100, locale, { decimals: 0, signed: false }) })}
        </p>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {brief.components.map((item) => (
            <li key={item.key} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2" data-testid={`summary-${item.key}`} data-status={item.status}>
              <span className="text-sm">{t(`research.components.${item.key}`)}</span>
              <StatusBadge tone={STATUS_TONE[item.status]}>{t(`research.status.${item.status}`)}</StatusBadge>
            </li>
          ))}
        </ul>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <MomentumPanel item={component("momentum")} reason={reason} />
        <VolumePanel item={component("volume")} reason={reason} />
      </div>

      {/* 3. Foreign and broker flow per window. */}
      <FlowPanel brief={brief} foreign={component("foreign")} momentum={component("momentum")} broker={component("broker")} reason={reason} />

      {/* 7. Counter-evidence. */}
      <Panel title={t("research.counter.title")} testId="research-counter" description={t("research.counter.description")}>
        {brief.counterEvidence.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {brief.counterEvidence.map((item) => (
              <li key={item.key} data-testid="counter-item" data-key={item.key} className="flex items-start gap-2 text-sm">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
                <span>{item.text[locale]}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="counter-none">
            {component("foreign").status === "missing" && component("broker").status === "missing" && component("insider").status === "missing" ? t("research.counter.noData") : t("research.counter.none")}
          </p>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 4. Ownership (KSEI ≥1%): kept as a slot until the data is connected. */}
        <Panel title={t("research.ownership.title")} testId="research-ownership">
          {component("ksei").status === "missing"
            ? <EmptyState compact icon={<Database />} title={t("research.ownership.missing")} description={t("research.ownership.missingDescription")} />
            : null}
        </Panel>
        {/* 5. Insider. */}
        <InsiderPanel brief={brief} item={component("insider")} reason={reason} />
      </div>

      {/* 8. Data quality. */}
      <Panel title={t("research.quality.title")} testId="research-quality" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-data" aria-label={t("research.quality.title")}>
            <thead>
              <tr>
                <th scope="col" className={`${th} text-left`}>{t("research.quality.component")}</th>
                <th scope="col" className={`${th} text-left`}>{t("research.quality.status")}</th>
                <th scope="col" className={`${th} text-left`}>{t("research.quality.note")}</th>
                <th scope="col" className={`${th} text-left`}>{t("research.quality.source")}</th>
                <th scope="col" className={`${th} text-left`}>{t("research.quality.asOf")}</th>
              </tr>
            </thead>
            <tbody>
              {brief.components.map((item) => (
                <tr key={item.key} data-testid={`quality-${item.key}`} data-status={item.status}>
                  <td className={td}>{t(`research.components.${item.key}`)}</td>
                  <td className={td}><StatusBadge tone={STATUS_TONE[item.status]}>{t(`research.status.${item.status}`)}</StatusBadge></td>
                  <td className={`${td} text-muted-foreground`}>{item.status === "missing" ? reason(item) : "—"}</td>
                  <td className={`${td} ticker text-xs`}>{item.source.table}</td>
                  <td className={`${td} num whitespace-nowrap`}>{formatDate(item.source.asOf, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-2 p-4">
          <h4 className="eyebrow-style text-soft">{t("research.quality.checks")}</h4>
          <ul className="flex flex-col gap-1.5">
            {brief.checks.map((check) => (
              <li key={check.key} className="flex flex-wrap items-center justify-between gap-2 text-sm" data-testid={`check-${check.key}`} data-result={check.result}>
                <span>{t(`research.quality.checkNames.${check.key}`)}</span>
                <StatusBadge tone={check.result === "match" ? "info" : check.result === "mismatch" ? "warning" : "neutral"}>{t(`research.quality.results.${check.result}`)}</StatusBadge>
              </li>
            ))}
          </ul>
        </div>
      </Panel>

      {/* 9. Sources and method. */}
      <Panel title={t("research.sources.title")} testId="research-sources" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-data" aria-label={t("research.sources.title")}>
            <thead>
              <tr>
                <th scope="col" className={`${th} text-left`}>{t("research.sources.table")}</th>
                <th scope="col" className={`${th} text-left`}>{t("research.sources.asOf")}</th>
                <th scope="col" className={`${th} text-left`}>{t("research.sources.range")}</th>
                <th scope="col" className={`${th} text-right`}>{t("research.sources.rows")}</th>
              </tr>
            </thead>
            <tbody>
              {brief.sources.map((source) => (
                <tr key={source.table} data-testid="source-row">
                  <td className={`${td} ticker text-xs`}>{source.table}</td>
                  <td className={`${td} num whitespace-nowrap`}>{formatDate(source.asOf, locale)}</td>
                  <td className={`${td} num whitespace-nowrap`}>{source.range ? source.range.split("/").map((date) => formatDate(date, locale)).join(" – ") : "—"}</td>
                  <td className={`${td} num text-right`}>{formatNumber(source.rows, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-1.5 p-4 text-sm">
          <h4 className="eyebrow-style text-soft">{t("research.sources.methodTitle")}</h4>
          <p>{t("research.sources.price")}</p>
          <p>{t("research.sources.windows")}</p>
          <p>{t("research.sources.baseline")}</p>
          <p>{t("research.sources.insider", { days: num(component("insider").raw, "lookbackDays") ?? 30 })}</p>
          <p className="font-medium" data-testid="research-version">{t("research.sources.version")}</p>
        </div>
      </Panel>

      <ResearchDisclaimer />
    </>
  );
}

type Reason = (item: BriefComponent) => string;
type T = ReturnType<typeof useTranslations>;

function reasonText(item: BriefComponent, t: T): string {
  const code = item.reason ?? "";
  if (item.key === "ksei" && code === "NOT_AVAILABLE") return t("research.reasons.ksei");
  if (BRIEF_REASONS.has(code)) return t(`research.reasons.${code}`);
  return t(`dataState.reasons.${PROVIDER_REASONS.has(code) ? code : "default"}`);
}

function Missing({ item, reason }: { item: BriefComponent; reason: Reason }) {
  return <EmptyState compact icon={<Database />} title={reason(item)} />;
}

function MomentumPanel({ item, reason }: { item: BriefComponent; reason: Reason }) {
  const t = useTranslations("research");
  const locale = useLocale() as Locale;
  const raw = item.raw;
  const position = str(raw, "closeVsSma20");
  return (
    <Panel title={t("momentum.title")} testId="research-momentum" actions={<StatusBadge tone={STATUS_TONE[item.status]}>{t(`status.${item.status}`)}</StatusBadge>}>
      {item.status === "missing" ? <Missing item={item} reason={reason} /> : (
        <>
          <dl className="grid grid-cols-5 gap-2">
            {(["1D", "5D", "7D", "14D", "30D"] as const).map((window) => (
              <div key={window} className="flex flex-col gap-0.5">
                <dt className="caption-style text-subtle">{window}</dt>
                <dd><ChangeValue percent={num(raw, `change${window}Pct`)} className="text-sm" /></dd>
              </div>
            ))}
          </dl>
          {position && (
            <p className="text-sm text-muted-foreground">
              {t(position === "above" ? "momentum.smaAbove" : position === "below" ? "momentum.smaBelow" : "momentum.smaAt", { date: formatDate(str(raw, "session"), locale), sma: formatIdr(num(raw, "sma20"), locale, { decimals: 0 }) })}
            </p>
          )}
        </>
      )}
    </Panel>
  );
}

function VolumePanel({ item, reason }: { item: BriefComponent; reason: Reason }) {
  const t = useTranslations("research");
  const locale = useLocale() as Locale;
  const raw = item.raw;
  const ratio = (key: string) => {
    const value = num(raw, key);
    return value === null ? "—" : t("volume.ratio", { ratio: formatNumber(value, locale, { decimals: 2 }) });
  };
  const rows: Array<{ id: string; label: string; value: string; baseline: string; ratio: string }> = [
    { id: "volume", label: t("volume.volume"), value: formatVolume(num(raw, "volumeShares"), locale, { compact: true }), baseline: formatVolume(num(raw, "avgVolumeShares"), locale, { compact: true }), ratio: ratio("volumeRatio") },
    { id: "value", label: t("volume.value"), value: formatIdr(num(raw, "valueIdr"), locale, { compact: true }), baseline: formatIdr(num(raw, "avgValueIdr"), locale, { compact: true }), ratio: ratio("valueRatio") },
    { id: "order", label: t("volume.orderSize"), value: formatIdr(num(raw, "orderSizeIdr"), locale, { compact: true }), baseline: formatIdr(num(raw, "avgOrderSizeIdr"), locale, { compact: true }), ratio: ratio("orderSizeRatio") },
  ];
  return (
    <Panel title={t("volume.title")} testId="research-volume" actions={<StatusBadge tone={STATUS_TONE[item.status]}>{t(`status.${item.status}`)}</StatusBadge>}
      description={item.status === "missing" ? undefined : t("volume.description", { date: formatDate(str(raw, "session"), locale), count: num(raw, "baselineSessions") ?? 0 })}>
      {item.status === "missing" ? <Missing item={item} reason={reason} /> : (
        <dl className="flex flex-col gap-2">
          {rows.map((row) => (
            <div key={row.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5" data-testid={`volume-${row.id}`}>
              <dt className="text-sm text-muted-foreground">{row.label}</dt>
              <dd className="flex items-baseline gap-2">
                <span className="ticker font-semibold">{row.value}</span>
                <span className="caption-style num text-subtle">{t("volume.baseline", { value: row.baseline })}</span>
                <span className="num text-sm">{row.ratio}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </Panel>
  );
}

function FlowPanel({ brief, foreign, momentum, broker, reason }: { brief: ResearchBrief; foreign: BriefComponent; momentum: BriefComponent; broker: BriefComponent; reason: Reason }) {
  const t = useTranslations("research");
  const locale = useLocale() as Locale;
  const session = str(foreign.raw, "session") ?? str(broker.raw, "end1D");
  const brokerValue = (flow: "foreign" | "domestic", window: string) => formatIdr(num(broker.raw, `${flow}${window}`), locale, { compact: true });
  return (
    <Panel title={t("flow.title")} testId="research-flow" bodyClassName="p-0"
      actions={<><StatusBadge tone={STATUS_TONE[foreign.status]}>{t("components.foreign")}: {t(`status.${foreign.status}`)}</StatusBadge><StatusBadge tone={STATUS_TONE[broker.status]}>{t("components.broker")}: {t(`status.${broker.status}`)}</StatusBadge></>}>
      {session && <p className="caption-style px-4 pt-4 leading-snug text-subtle">{t("flow.description", { date: formatDate(session, locale) })}</p>}
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-data" aria-label={t("flow.title")}>
          <thead>
            <tr>
              <th scope="col" className={`${th} text-left`}>{t("flow.window")}</th>
              <th scope="col" className={`${th} text-right`}>{t("flow.price")}</th>
              <th scope="col" className={`${th} text-right`}>{t("flow.foreignNet")}</th>
              <th scope="col" className={`${th} text-right`}>{t("flow.foreignValue")}</th>
              <th scope="col" className={`${th} text-right`}>{t("flow.domesticValue")}</th>
              <th scope="col" className={`${th} text-right`}>{t("flow.localInstitution")}</th>
              <th scope="col" className={`${th} text-right`}>{t("flow.retail")}</th>
            </tr>
          </thead>
          <tbody>
            {brief.windows.map((window) => (
              <tr key={window} data-testid={`flow-row-${window}`}>
                <td className={td}><span className="ticker">{window}</span></td>
                <td className={`${td} text-right`}><ChangeValue percent={num(momentum.raw, `change${window}Pct`)} /></td>
                <td className={`${td} num text-right`} data-testid={`flow-foreign-${window}`}>{formatVolume(num(foreign.raw, `net${window}`), locale, { compact: true, signed: true })}</td>
                <td className={`${td} num text-right`}>{brokerValue("foreign", window)}</td>
                <td className={`${td} num text-right`}>{brokerValue("domestic", window)}</td>
                <td className={`${td} text-right text-subtle`}>—</td>
                <td className={`${td} text-right text-subtle`}>—</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-1 p-4 text-xs text-muted-foreground">
        {foreign.status !== "missing" && num(foreign.raw, "flowSessions") !== null && (
          <p>{t("flow.sessionsSummary", { sessions: num(foreign.raw, "flowSessions")!, buy: num(foreign.raw, "buySessions") ?? 0, sell: num(foreign.raw, "sellSessions") ?? 0 })}</p>
        )}
        {foreign.status === "missing" && <p>{t("flow.foreignMissing", { reason: reason(foreign) })}</p>}
        {broker.status === "missing" && <p data-testid="broker-missing">{t("flow.brokerMissing", { reason: reason(broker) })}</p>}
        <p>{t("flow.categoriesNote")}</p>
      </div>
    </Panel>
  );
}

function InsiderPanel({ brief, item, reason }: { brief: ResearchBrief; item: BriefComponent; reason: Reason }) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const raw = item.raw;
  const days = num(raw, "lookbackDays") ?? 30;
  const count = num(raw, "transactions") ?? 0;
  const until = formatDate(brief.price.session, locale);
  return (
    <Panel title={t("research.insider.title")} testId="research-insider" actions={<StatusBadge tone={STATUS_TONE[item.status]}>{t(`research.status.${item.status}`)}</StatusBadge>}>
      {item.status === "missing" ? <Missing item={item} reason={reason} /> : (
        <>
          <p className="text-sm" data-testid="insider-summary">
            {count > 0
              ? t("research.insider.summary", { count, days, date: until, buys: num(raw, "buys") ?? 0, sells: num(raw, "sells") ?? 0 })
              : t("research.insider.none", { days, date: until })}
          </p>
          {count > 0 && <p className="text-sm text-muted-foreground">{t("research.insider.net", { net: formatVolume(num(raw, "netShares"), locale, { compact: true, signed: true }) })}</p>}
          {str(raw, "latestDate") === null && item.source.asOf && <p className="caption-style text-subtle">{t("research.insider.latest", { date: formatDate(item.source.asOf, locale) })}</p>}
          {num(raw, "truncated") === 1 && <p className="caption-style text-warning">{t("research.insider.truncated")}</p>}
          {brief.insiderTransactions.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-0 text-data" aria-label={t("insiders.title")}>
                <thead>
                  <tr>
                    <th scope="col" className={`${th} text-left`}>{t("insiders.date")}</th>
                    <th scope="col" className={`${th} text-left`}>{t("insiders.person")}</th>
                    <th scope="col" className={`${th} text-left`}>{t("insiders.action")}</th>
                    <th scope="col" className={`${th} text-right`}>{t("insiders.change")}</th>
                  </tr>
                </thead>
                <tbody>
                  {brief.insiderTransactions.map((row, index) => (
                    <tr key={`${row.date}-${row.person}-${index}`} data-testid="insider-row">
                      <td className={`${td} num whitespace-nowrap`}>{formatDate(row.date, locale)}</td>
                      <td className={td}>
                        <span className="flex flex-col"><span className="block max-w-60 truncate" title={row.person}>{row.person}</span>{row.roles.length > 0 && <span className="text-[11px] text-muted-foreground">{row.roles.join(", ")}</span>}</span>
                      </td>
                      <td className={td}><StatusBadge tone="neutral">{t(`research.insider.actions.${row.action}`)}</StatusBadge></td>
                      <td className={`${td} num text-right`}>{formatVolume(row.changeShares, locale, { compact: true })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
