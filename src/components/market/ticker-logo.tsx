"use client";

import { useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

/**
 * Monogram hues (oklch). Color carries meaning only (globals.css), so a ticker badge must never read as
 * up/down: greens (≈120–170) and reds (≈0–40, 340–360) are excluded. Blues, violets, cyan and amber remain.
 */
const MONOGRAM_HUES = [200, 218, 236, 254, 272, 290, 64, 84] as const;

/** Issuer logos are opt-in: their only source today is TradingView, which is internal-use only (DATA-ENGINE.md §8). */
const LOGOS_ENABLED = process.env.NEXT_PUBLIC_TICKER_LOGOS === "1";

const SIZES = {
  xs: "size-4 text-[7px]",
  sm: "size-5 text-[8px]",
  md: "size-7 text-[10px]",
  lg: "size-10 text-[13px]",
} as const;

/** Stable hue for a symbol, so BBCA is the same color on every screen. */
export function monogramHue(symbol: string): number {
  let hash = 0;
  for (const char of symbol) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return MONOGRAM_HUES[hash % MONOGRAM_HUES.length];
}

/** Two letters for the badge: IDX codes are four letters, the leading pair reads best at small sizes. */
export function monogramLetters(symbol: string): string {
  return symbol.replace(/[^A-Z0-9]/gi, "").slice(0, 2).toUpperCase();
}

/**
 * Issuer mark beside a ticker. Always renders our own monogram; when logos are enabled, the issuer's logo
 * (served from our origin by `/api/logos/{SYMBOL}`) fades in over it and any failure keeps the monogram,
 * so there is never a broken image or a layout shift. Decorative: the ticker text next to it is the label.
 */
export function TickerLogo({ symbol, size = "sm", className }: { symbol: string; size?: keyof typeof SIZES; className?: string }) {
  const [image, setImage] = useState<"loading" | "loaded" | "failed">("loading");
  const code = symbol.toUpperCase();
  return (
    <span
      aria-hidden
      data-testid={`ticker-logo-${code}`}
      data-logo={LOGOS_ENABLED && image === "loaded" ? "image" : "monogram"}
      style={{ "--mono-h": monogramHue(code) } as CSSProperties}
      className={cn("ticker-mono relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold tracking-tight select-none", SIZES[size], className)}
    >
      {monogramLetters(code)}
      {LOGOS_ENABLED && image !== "failed" && (
        // eslint-disable-next-line @next/next/no-img-element -- same-origin SVG; the image optimizer doesn't process SVG
        <img
          src={`/api/logos/${encodeURIComponent(code)}`}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setImage("loaded")}
          onError={() => setImage("failed")}
          className={cn("absolute inset-0 size-full bg-(--logo-plate) object-contain transition-opacity duration-200 ease-power3-out", image === "loaded" ? "opacity-100" : "opacity-0")}
        />
      )}
    </span>
  );
}
