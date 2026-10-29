import {
  ArrowRight, BookOpenCheck, CandlestickChart, Compass, Eye, FileSpreadsheet, Gauge, Languages, Lock, Scale, Search,
  UsersRound, Waypoints, type Icon as IconComponent,
} from "@/components/kit/icons";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { FreshnessBadge } from "@/components/feedback/freshness-badge";
import { LocaleSwitch, ThemeToggle } from "@/components/layout/preference-controls";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { Freshness } from "@/lib/freshness";
import type { Theme } from "@/lib/preferences";
import type { Viewer } from "@/server/viewer";
import { ProductPreview } from "./product-preview";

const FEATURES: Array<{ key: string; icon: IconComponent }> = [
  { key: "flow", icon: Waypoints },
  { key: "financials", icon: FileSpreadsheet },
  { key: "insiders", icon: UsersRound },
  { key: "analysis", icon: Gauge },
  { key: "history", icon: CandlestickChart },
  { key: "discover", icon: Compass },
];
const PRINCIPLES: Array<{ key: string; icon: IconComponent }> = [
  { key: "observed", icon: Eye },
  { key: "neutral", icon: Scale },
  { key: "privacy", icon: Lock },
  { key: "local", icon: Languages },
];
const STATES: Freshness[] = ["DELAYED", "EOD", "HISTORICAL", "STALE", "UNAVAILABLE"];
const STEP_ICONS: IconComponent[] = [Search, BookOpenCheck, Eye];

function Section({ id, eyebrow, title, intro, children, className }: { id: string; eyebrow: string; title: string; intro?: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={`scroll-mt-20 border-t border-border ${className ?? ""}`}>
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-16 md:px-6 md:py-24">
        <div className="flex max-w-2xl flex-col gap-3">
          <span className="eyebrow-style text-primary">{eyebrow}</span>
          <h2 id={`${id}-title`} className="text-[28px] leading-tight font-semibold tracking-[-0.02em] md:text-[36px]">{title}</h2>
          {intro && <p className="text-base leading-relaxed text-soft">{intro}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}

/** Public landing page at the locale root ("/id", "/en"). Server-rendered; only the locale and theme controls are client components. */
export async function LandingPage({ viewer, theme }: { viewer: Viewer; theme: Theme }) {
  const t = await getTranslations("landing");
  const tApp = await getTranslations("app");
  const signedIn = viewer.kind === "user" || viewer.kind === "bypass";
  const facts = t.raw("facts.items") as Array<{ value: string; label: string }>;
  const steps = t.raw("how.steps") as Array<{ title: string; body: string }>;
  const faq = t.raw("faq.items") as Array<{ q: string; a: string }>;

  const ctas = (testId: string) => (
    <div className="flex flex-wrap items-center gap-3" data-testid={testId}>
      {signedIn ? (
        <Button asChild variant="primary" size="lg"><Link href="/dashboard">{t("cta.open")}<ArrowRight /></Link></Button>
      ) : (
        <>
          <Button asChild variant="primary" size="lg"><Link href="/signup?next=%2Fdashboard">{t("cta.signup")}<ArrowRight /></Link></Button>
          <Button asChild variant="outline" size="lg"><Link href="/login?next=%2Fdashboard">{t("cta.signin")}</Link></Button>
        </>
      )}
    </div>
  );

  return (
    <div className="relative" data-testid="landing">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 md:px-6">
          <Link href="/" className="shrink-0">
            {/* Phones get the symbol only: with locale, theme and the CTA the full wordmark overflows 360px. */}
            <span className="sm:hidden"><Logo variant="symbol" height={30} alt={tApp("name")} priority /></span>
            <span className="hidden sm:block"><Logo variant="horizontal" height={30} alt={tApp("name")} priority /></span>
          </Link>
          <nav aria-label={t("nav.label")} className="hidden items-center gap-6 text-sm text-soft md:flex">
            <a href="#features" className="hover:text-foreground">{t("nav.features")}</a>
            <a href="#freshness" className="hover:text-foreground">{t("nav.freshness")}</a>
            <a href="#how" className="hover:text-foreground">{t("nav.how")}</a>
            <a href="#faq" className="hover:text-foreground">{t("nav.faq")}</a>
          </nav>
          <div className="flex items-center gap-1">
            <LocaleSwitch />
            <ThemeToggle initial={theme} />
            <Button asChild variant={signedIn ? "primary" : "secondary"} size="md" className="ml-1">
              <Link href={signedIn ? "/dashboard" : "/login?next=%2Fdashboard"}>{signedIn ? t("cta.open") : t("cta.signin")}</Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_70%_20%,color-mix(in_oklab,var(--primary)_22%,transparent),transparent_70%)]" />
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(70%_60%_at_50%_0%,black,transparent)] opacity-60" />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pt-16 pb-20 md:px-6 md:pt-24 lg:grid-cols-[1.05fr_1fr]">
            <div className="flex flex-col gap-6">
              <span className="eyebrow-style text-primary">{t("hero.eyebrow")}</span>
              <h1 className="font-brand text-[40px] leading-[1.05] font-semibold tracking-[-0.03em] text-balance md:text-[56px]" data-testid="landing-title">{t("hero.title")}</h1>
              <p className="max-w-xl text-lg leading-relaxed text-soft">{t("hero.subtitle")}</p>
              {ctas("landing-hero-cta")}
              <p className="caption-style leading-snug text-subtle">{signedIn ? t("hero.noteSignedIn") : t("hero.noteSignedOut")}</p>
            </div>
            <ProductPreview />
          </div>
        </section>

        {/* Facts */}
        <section aria-label={t("facts.title")} className="border-t border-border bg-card/40">
          <dl className="mx-auto grid max-w-6xl grid-cols-2 gap-px px-4 md:grid-cols-4 md:px-6" data-testid="landing-facts">
            {facts.map((fact) => (
              <div key={fact.label} className="flex flex-col gap-1.5 py-8 md:px-4">
                <dt className="order-2 text-sm text-soft">{fact.label}</dt>
                <dd className="ticker order-1 text-[32px] leading-none font-semibold tracking-[-0.02em]">{fact.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <Section id="features" eyebrow={t("features.eyebrow")} title={t("features.title")} intro={t("features.intro")}>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ key, icon: Icon }) => (
              <li key={key} className="flex flex-col gap-3 rounded-xl border border-border bg-card/60 p-5 transition-colors hover:border-line-strong">
                <span className="flex size-9 items-center justify-center rounded-lg bg-primary/12 text-primary"><Icon className="size-4" /></span>
                <h3 className="font-brand text-base font-semibold">{t(`features.items.${key}.title`)}</h3>
                <p className="text-sm leading-relaxed text-soft">{t(`features.items.${key}.body`)}</p>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="freshness" eyebrow={t("freshness.eyebrow")} title={t("freshness.title")} intro={t("freshness.intro")} className="bg-card/40">
          <div className="flex flex-col gap-4">
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-5" data-testid="landing-freshness">
              {STATES.map((state) => (
                <li key={state} className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
                  <FreshnessBadge freshness={state} asOf={null} className="self-start" />
                  <p className="text-sm leading-relaxed text-soft">{t(`freshness.states.${state}`)}</p>
                </li>
              ))}
            </ul>
            <p className="caption-style text-subtle">{t("freshness.hover")}</p>
          </div>
        </Section>

        <Section id="how" eyebrow={t("how.eyebrow")} title={t("how.title")}>
          <ol className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {steps.map((step, index) => {
              const Icon = STEP_ICONS[index] ?? Eye;
              return (
                <li key={step.title} className="relative flex flex-col gap-3 rounded-xl border border-border p-5">
                  <div className="flex items-center gap-3">
                    <span className="ticker flex size-7 items-center justify-center rounded-full border border-line-strong text-xs">{index + 1}</span>
                    <Icon className="size-4 text-subtle" />
                  </div>
                  <h3 className="font-brand text-base font-semibold">{step.title}</h3>
                  <p className="text-sm leading-relaxed text-soft">{step.body}</p>
                </li>
              );
            })}
          </ol>
        </Section>

        <Section id="principles" eyebrow={t("principles.eyebrow")} title={t("principles.title")} className="bg-card/40">
          <ul className="grid grid-cols-1 gap-x-8 gap-y-8 sm:grid-cols-2">
            {PRINCIPLES.map(({ key, icon: Icon }) => (
              <li key={key} className="flex gap-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background"><Icon className="size-4 text-soft" /></span>
                <div className="flex flex-col gap-1.5">
                  <h3 className="font-brand text-base font-semibold">{t(`principles.items.${key}.title`)}</h3>
                  <p className="text-sm leading-relaxed text-soft">{t(`principles.items.${key}.body`)}</p>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="faq" eyebrow={t("faq.eyebrow")} title={t("faq.title")}>
          <Accordion type="multiple" className="rounded-xl border border-border bg-card/40 px-5 shadow-(--shadow-raised)" data-testid="landing-faq">
            {faq.map((item) => (
              <AccordionItem key={item.q} value={item.q}>
                <AccordionTrigger className="text-base">{item.q}</AccordionTrigger>
                <AccordionContent>{item.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Section>

        {/* Final call to action */}
        <section className="border-t border-border">
          <div className="mx-auto max-w-6xl px-4 py-16 md:px-6 md:py-24">
            <div className="relative flex flex-col items-start gap-6 overflow-hidden rounded-2xl border border-line-strong bg-card p-8 md:p-12">
              <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_80%_at_100%_0%,color-mix(in_oklab,var(--primary)_18%,transparent),transparent_70%)]" />
              <h2 className="font-brand relative max-w-2xl text-[28px] leading-tight font-semibold tracking-[-0.02em] md:text-[36px]">{t("final.title")}</h2>
              <p className="relative max-w-xl text-base leading-relaxed text-soft">{t("final.body")}</p>
              <div className="relative">{ctas("landing-final-cta")}</div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 text-sm md:flex-row md:items-start md:justify-between md:px-6">
          <div className="flex flex-col gap-1.5">
            <Logo variant="horizontal" height={30} alt={tApp("name")} className="mb-3" />
            <span className="text-soft">{t("footer.tagline")}</span>
            <span className="caption-style max-w-md leading-snug text-subtle">{t("footer.disclaimer")}</span>
          </div>
          <nav aria-label={t("nav.label")} className="flex flex-wrap gap-x-6 gap-y-2 text-soft">
            <Link href="/dashboard" className="hover:text-foreground">{t("footer.app")}</Link>
            {!signedIn && <Link href="/login?next=%2Fdashboard" className="hover:text-foreground">{t("cta.signin")}</Link>}
            <Link href="/" locale="id" className="hover:text-foreground">Bahasa Indonesia</Link>
            <Link href="/" locale="en" className="hover:text-foreground">English</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
