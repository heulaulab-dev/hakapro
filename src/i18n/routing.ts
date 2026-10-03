import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["id", "en"],
  defaultLocale: "id",
  localePrefix: "always",
  // "/" always lands on Indonesian; the locale changes only via the URL/locale switch.
  localeDetection: false,
});

export type AppLocale = (typeof routing.locales)[number];
