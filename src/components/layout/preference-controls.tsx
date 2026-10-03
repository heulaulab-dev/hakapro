"use client";

import { Check, Languages, Moon, Rows3, Rows4, Sun } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, type AppLocale } from "@/i18n/routing";
import { DENSITY_COOKIE, THEME_COOKIE, type Density, type Theme } from "@/lib/preferences";

function writeCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
}

/** `initial` comes from the server-read cookie, so server and client render the same icon. */
export function ThemeToggle({ initial }: { initial: Theme }) {
  const t = useTranslations("header");
  const [current, setTheme] = useState<Theme>(initial);
  const next: Theme = current === "dark" ? "light" : "dark";
  const label = next === "dark" ? t("themeToDark") : t("themeToLight");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          data-testid="theme-toggle"
          onClick={() => {
            document.documentElement.classList.remove("dark", "light");
            document.documentElement.classList.add(next);
            writeCookie(THEME_COOKIE, next);
            setTheme(next);
          }}
        >
          {current === "dark" ? <Sun /> : <Moon />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function DensityToggle({ initial }: { initial: Density }) {
  const t = useTranslations();
  const [current, setDensity] = useState<Density>(initial);
  const next: Density = current === "comfortable" ? "compact" : "comfortable";
  const label = `${t("header.density")}: ${t(`density.${next}`)}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          data-testid="density-toggle"
          onClick={() => {
            document.documentElement.dataset.density = next;
            writeCookie(DENSITY_COOKIE, next);
            setDensity(next);
          }}
        >
          {current === "comfortable" ? <Rows4 /> : <Rows3 />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function LocaleSwitch() {
  const t = useTranslations();
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" aria-label={t("header.locale")} data-testid="locale-switch" disabled={pending} className="gap-1.5">
              <Languages />
              <span className="ticker text-xs uppercase">{locale}</span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("header.locale")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("header.locale")}</DropdownMenuLabel>
        {routing.locales.map((candidate) => (
          <DropdownMenuItem
            key={candidate}
            data-testid={`locale-${candidate}`}
            onSelect={() => startTransition(() => router.replace(pathname, { locale: candidate as AppLocale }))}
          >
            <Check className={candidate === locale ? "opacity-100" : "opacity-0"} />
            {t(`locale.${candidate}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
