"use client";

import { useSyncExternalStore } from "react";

/** Breakpoints that mirror Tailwind's `sm` / `md`, for behaviour (not styling) that must differ on phones. */
export const MEDIA = {
  /** Below Tailwind `sm` (640px): data tables turn into cards. */
  phone: "(max-width: 639px)",
  /** Below Tailwind `md` (768px): the bottom nav is shown. */
  belowMd: "(max-width: 767px)",
  /** Touch is the primary input: hover tooltips are unreachable. */
  coarse: "(pointer: coarse)",
} as const;

/**
 * Subscribes to a media query. The server snapshot is `false`, so the first client render matches the
 * server HTML and the layout adapts right after hydration.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
