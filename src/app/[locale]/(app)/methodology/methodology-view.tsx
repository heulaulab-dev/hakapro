"use client";

import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { ResearchDisclaimer } from "@/components/feedback/research-disclaimer";
import { Panel } from "@/components/layout/panel";
import { SectionHeader } from "@/components/layout/section-header";
import { formatRuleValue, useRadarText } from "@/components/radar/radar-chips";
import { Link } from "@/i18n/navigation";
import type { Radar } from "@/lib/api/market";
import { formatPercent, type Locale } from "@/lib/format";
import { RADAR_COUNTER_KEYS, RADAR_RULES_V0, RADAR_SIGNAL_KEYS, STEALTH_RULES_V0 } from "@/lib/radar/rules";

/** The radar rules in the shape the API echoes, built from the same config object the engine evaluates. */
const RULES = Object.fromEntries(RADAR_SIGNAL_KEYS.map((key) => {
  const { window, baseline, threshold, unit } = RADAR_RULES_V0.signals[key];
  return [key, { window, baseline, threshold, unit }];
})) as Radar["rules"];

const SOURCES = ["arjum", "prices", "ksei", "intraday"] as const;
const PRINCIPLES = ["observe", "trace", "missing", "counter"] as const;

const th = "caption-style h-[38px] border-b border-border px-3 text-left font-normal whitespace-nowrap text-subtle";
const td = "border-b border-border px-3 py-cell-y align-top";

function Table({ head, children, testId }: { head: string[]; children: ReactNode; testId?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm" data-testid={testId}>
        <thead><tr>{head.map((label) => <th key={label} className={th}>{label}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/**
 * Playbook: what each data source is and when it arrives, every radar signal and threshold (rendered from the rules
 * config, so the text cannot drift from the code), what counter-evidence means, and why there is no score yet.
 */
export function MethodologyView() {
  const t = useTranslations("methodology");
  const locale = useLocale() as Locale;
  const text = useRadarText();
  const windowText = (window: number | null, baseline: number | null) =>
    window === null ? t("radar.monthly") : baseline ? t("radar.windowBaseline", { window, baseline }) : t("radar.window", { window });

  return (
    <div className="flex flex-col gap-section p-4 md:p-6" data-testid="methodology-view">
      <SectionHeader as="h1" title={t("title")} description={t("intro")} />

      <Panel title={t("principles.title")} testId="methodology-principles">
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm">
          {PRINCIPLES.map((key) => <li key={key}>{t(`principles.${key}`)}</li>)}
        </ul>
      </Panel>

      <Panel title={t("sources.title")} description={t("sources.intro")} testId="methodology-sources">
        <Table head={[t("sources.source"), t("sources.what"), t("sources.when")]}>
          {SOURCES.map((key) => (
            <tr key={key} data-testid={`source-${key}`}>
              <td className={`${td} font-medium`}>{t(`sources.${key}.name`)}</td>
              <td className={td}>{t(`sources.${key}.what`)}</td>
              <td className={td}>{t(`sources.${key}.when`)}</td>
            </tr>
          ))}
        </Table>
      </Panel>

      <Panel title={t("radar.title")} description={t("radar.intro")} testId="methodology-radar"
        actions={<Link href="/discover/radar" className="caption-style text-link hover:underline touch-target">{t("radar.open")}</Link>}>
        <p className="caption-style ticker text-subtle" data-testid="methodology-radar-version">{t("version", { version: RADAR_RULES_V0.version })}</p>
        <Table head={[t("radar.signal"), t("radar.measures"), t("radar.windowHead"), t("radar.threshold"), t("radar.needs")]} testId="methodology-signals">
          {RADAR_SIGNAL_KEYS.map((key) => {
            const rule = RADAR_RULES_V0.signals[key];
            return (
              <tr key={key} data-testid={`rule-${key}`}>
                <td className={`${td} font-medium`}>{text.name(key, RULES)}</td>
                <td className={td}>{t(`radar.describe.${key}`, { window: rule.window ?? 0, baseline: rule.baseline ?? 0 })}</td>
                <td className={`${td} num whitespace-nowrap`}>{windowText(rule.window, rule.baseline)}</td>
                <td className={`${td} num whitespace-nowrap`} data-testid={`threshold-${key}`}>≥ {formatRuleValue(rule.threshold, rule.unit, locale)}</td>
                <td className={td}>{rule.inputs.map((input) => t(`inputs.${input}`)).join(", ")}</td>
              </tr>
            );
          })}
        </Table>
        <p className="text-sm">{t("radar.ranking", { limit: RADAR_RULES_V0.listLimit })}</p>
        <p className="text-sm">{t("radar.foreignCoverage")}</p>
      </Panel>

      <Panel title={t("counter.title")} description={t("counter.intro")} testId="methodology-counter">
        <ul className="flex flex-col gap-2 text-sm">
          {RADAR_COUNTER_KEYS.map((key) => {
            const rule = RADAR_RULES_V0.counter[key] as { window?: number; threshold?: number };
            return (
              <li key={key} data-testid={`counter-rule-${key}`}>
                <span className="font-medium">{text.counterName(key)}</span>
                {": "}
                {t(`counter.describe.${key}`, {
                  window: rule.window ?? 0, threshold: rule.threshold ?? 0,
                  volume: formatRuleValue(RADAR_RULES_V0.signals.volumeSpike.threshold, "ratio", locale), baseline: RADAR_RULES_V0.signals.volumeSpike.baseline,
                })}
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel title={t("stealth.title")} description={t("stealth.intro")} testId="methodology-stealth"
        actions={<Link href="/discover/stealth" className="caption-style text-link hover:underline touch-target">{t("stealth.open")}</Link>}>
        <p className="caption-style ticker text-subtle" data-testid="methodology-stealth-version">{t("version", { version: STEALTH_RULES_V0.version })}</p>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm">
          <li>{t("stealth.types", { types: STEALTH_RULES_V0.investorTypes.join(", ") })}</li>
          <li>{t("stealth.combined")}</li>
          <li data-testid="methodology-stealth-price">{t("stealth.price", { max: formatPercent(STEALTH_RULES_V0.maxPriceChange * 100, locale, { decimals: 1 }), gap: STEALTH_RULES_V0.maxCloseGapDays })}</li>
          <li>{t("stealth.notIntent")}</li>
        </ul>
      </Panel>

      <Panel title={t("noScore.title")} testId="methodology-no-score">
        <div className="flex flex-col gap-2 text-sm">
          <p>{t("noScore.p1")}</p>
          <p>{t("noScore.p2")}</p>
          <p>{t("noScore.p3")}</p>
        </div>
      </Panel>

      <Panel title={t("missing.title")} testId="methodology-missing">
        <p className="text-sm">{t("missing.body")}</p>
      </Panel>

      <ResearchDisclaimer />
      <p className="caption-style text-subtle" data-testid="methodology-disclaimer">{t("disclaimer")}</p>
    </div>
  );
}
