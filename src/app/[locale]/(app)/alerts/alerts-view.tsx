"use client";

import { Bell, LogIn, Trash2 } from "lucide-react";
import { parseAsString, useQueryState } from "nuqs";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { EmptyState } from "@/components/feedback/empty-state";
import { stockHref } from "@/components/layout/nav-config";
import { SectionHeader } from "@/components/layout/section-header";
import type { ViewerSummary } from "@/components/layout/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import { ALERT_METRICS, ALERT_OPERATORS, METRIC_FORMAT, validThreshold, type AlertMetric, type AlertOperator } from "@/lib/alerts";
import { useAlertEvents, useAlertMutations, useAlerts } from "@/lib/alerts-client";
import { formatDate, formatValue, type Locale } from "@/lib/format";

const TICKER = /^[A-Z0-9]{1,12}$/;
const selectClass = "h-8 rounded-md border border-input bg-background px-2 text-sm";

export function AlertsView({ viewer }: { viewer: ViewerSummary }) {
  const t = useTranslations("alerts");
  const locale = useLocale() as Locale;
  const userId = viewer.kind === "user" ? viewer.id : null;
  const [prefill] = useQueryState("symbol", parseAsString.withDefault(""));
  const [symbol, setSymbol] = useState(prefill.toUpperCase());
  const [metric, setMetric] = useState<AlertMetric>("PRICE");
  const [operator, setOperator] = useState<AlertOperator>("LT");
  const [threshold, setThreshold] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const alerts = useAlerts(userId);
  const events = useAlertEvents(userId);
  const { create, toggle, remove } = useAlertMutations(userId);

  if (viewer.kind !== "user") {
    return (
      <div className="flex flex-col gap-section p-4 md:p-6" data-testid="alerts-view">
        <SectionHeader as="h1" title={t("title")} description={t("intro")} />
        <EmptyState icon={<LogIn />} title={t("signIn")} />
      </div>
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const code = symbol.trim().toUpperCase();
    const value = Number(threshold);
    if (!TICKER.test(code) || threshold.trim() === "" || !validThreshold(metric, value)) return setMessage(t("invalid"));
    setMessage(null);
    create.mutate({ symbol: code, metric, operator, threshold: value }, { onSuccess: () => setThreshold(""), onError: () => setMessage(t("failed")) });
  }

  const describe = (row: { metric: AlertMetric; operator: AlertOperator; threshold: number }) => `${t(`metrics.${row.metric}`)} ${t(`operators.${row.operator}`)} ${formatValue(row.threshold, METRIC_FORMAT[row.metric], locale)}`;

  return (
    <div className="flex flex-col gap-section p-4 md:p-6" data-testid="alerts-view">
      <SectionHeader as="h1" title={t("title")} description={t("intro")} />
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-4" data-testid="alert-form">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">{t("symbol")}<Input value={symbol} onChange={(event) => setSymbol(event.target.value)} className="ticker h-8 w-28 uppercase" data-testid="alert-symbol" /></label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">{t("metric")}
          <select className={selectClass} value={metric} onChange={(event) => setMetric(event.target.value as AlertMetric)}>{ALERT_METRICS.map((value) => <option key={value} value={value}>{t(`metrics.${value}`)}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">{t("operator")}
          <select className={selectClass} value={operator} onChange={(event) => setOperator(event.target.value as AlertOperator)}>{ALERT_OPERATORS.map((value) => <option key={value} value={value}>{t(`operators.${value}`)}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">{t("threshold")}<Input type="number" step="any" inputMode="decimal" value={threshold} onChange={(event) => setThreshold(event.target.value)} className="ticker h-8 w-36" /></label>
        <Button type="submit" size="sm" disabled={create.isPending}><Bell />{t("create")}</Button>
        {message && <p role="alert" className="w-full text-xs text-negative">{message}</p>}
      </form>

      <section className="flex flex-col gap-2">
        <SectionHeader title={t("title")} />
        {alerts.data?.length === 0 ? <EmptyState compact title={t("empty")} /> : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card px-4">
            {alerts.data?.map((alert) => (
              <li key={alert.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <Link href={stockHref(alert.symbol)} className="ticker w-14 font-medium text-primary hover:underline">{alert.symbol}</Link>
                <span className="num flex-1">{describe(alert)}</span>
                {alert.last_triggered_at && <span className="text-xs text-muted-foreground">{t("lastTriggered", { date: formatDate(alert.last_triggered_at, locale) })}</span>}
                <Button variant="outline" size="sm" aria-pressed={alert.enabled} onClick={() => toggle.mutate({ id: alert.id, enabled: !alert.enabled })}>{alert.enabled ? t("enabled") : t("disabled")}</Button>
                <Button variant="ghost" size="icon" aria-label={`${t("delete")} ${alert.symbol}`} onClick={() => remove.mutate(alert.id)}><Trash2 /></Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <SectionHeader title={t("events")} />
        {events.data?.length === 0 ? <EmptyState compact title={t("eventsEmpty")} /> : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card px-4">
            {events.data?.map((event) => event.alert && (
              <li key={event.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className="ticker w-14 font-medium">{event.alert.symbol}</span>
                <span className="num flex-1 text-muted-foreground">{describe(event.alert)}</span>
                <span className="num text-xs">{t("observed", { value: formatValue(Number(event.observed_value), METRIC_FORMAT[event.alert.metric], locale), date: formatDate(event.observed_as_of, locale) })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
