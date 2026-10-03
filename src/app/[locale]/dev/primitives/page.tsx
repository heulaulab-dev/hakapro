import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { FreshnessBadge } from "@/components/feedback/freshness-badge";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { FRESHNESS_STATES, type Freshness } from "@/lib/freshness";
import { formatDate, formatIdr, formatPercent, formatVolume, type Locale } from "@/lib/format";
import { DENSITIES, THEMES } from "@/lib/preferences";

/** Sample component props for the gallery. Not market data. */
const SAMPLE_PROPS: Record<Freshness, { asOf: string | null; period?: string }> = {
  LIVE: { asOf: "2026-09-18T10:30:00+07:00" },
  DELAYED: { asOf: "2026-09-18T10:20:00+07:00" },
  EOD: { asOf: "2026-09-18" },
  HISTORICAL: { asOf: "2026-09", period: "2020-01/2026-09" },
  STALE: { asOf: "2026-03-31", period: "Q1 2026" },
  UNAVAILABLE: { asOf: null },
};

export default async function PrimitivesPage({ params }: PageProps<"/[locale]/dev/primitives">) {
  if (process.env.NODE_ENV === "production") notFound();
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  const loc = locale as Locale;
  const other = routing.locales.find((candidate) => candidate !== locale)!;

  const formatting: Array<[string, string]> = [
    ["formatIdr(1.5e12, { compact })", formatIdr(1.5e12, loc, { compact: true })],
    ["formatIdr(6300)", formatIdr(6300, loc)],
    ["formatPercent(1.25)", formatPercent(1.25, loc)],
    ["formatPercent(-0.8)", formatPercent(-0.8, loc)],
    ["formatVolume(177e6, { compact })", formatVolume(177e6, loc, { compact: true })],
    ["formatVolume(1234500, { unit: 'lots' })", formatVolume(1_234_500, loc, { unit: "lots" })],
    ["formatDate('2026-09-18')", formatDate("2026-09-18", loc)],
  ];

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">{t("dev.primitivesTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("dev.primitivesIntro")}</p>
        </div>
        <Link href="/dev/primitives" locale={other} className="text-sm text-primary underline-offset-4 hover:underline">
          {t("locale.switchTo")}: {t(`locale.${other}`)}
        </Link>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        {THEMES.map((theme) =>
          DENSITIES.map((density) => (
            <section
              key={`${theme}-${density}`}
              data-testid={`panel-${theme}-${density}`}
              data-density={density}
              className={`${theme} rounded-lg border border-border bg-background p-4 text-foreground`}
            >
              <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {t(`theme.${theme}`)} · {t(`density.${density}`)}
              </h2>
              <h3 className="mb-2 text-sm font-medium">{t("dev.freshnessBadge")}</h3>
              <div className="mb-4 flex flex-wrap gap-2">
                {FRESHNESS_STATES.map((state) => (
                  <FreshnessBadge key={state} freshness={state} source="sample" {...SAMPLE_PROPS[state]} />
                ))}
              </div>
              <h3 className="mb-2 text-sm font-medium">{t("dev.formatting")}</h3>
              <table className="w-full text-data">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-cell-x py-cell-y font-medium">{t("dev.sampleInput")}</th>
                    <th className="px-cell-x py-cell-y text-right font-medium">{t("dev.sampleOutput")}</th>
                  </tr>
                </thead>
                <tbody>
                  {formatting.map(([input, output]) => (
                    <tr key={input} className="h-row border-t border-border">
                      <td className="px-cell-x py-cell-y font-mono text-xs text-muted-foreground">{input}</td>
                      <td className="ticker px-cell-x py-cell-y text-right">{output}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )),
        )}
      </div>
    </main>
  );
}
