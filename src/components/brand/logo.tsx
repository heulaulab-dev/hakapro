import Image from "next/image";
import { cn } from "@/lib/utils";

export type LogoVariant = "horizontal" | "stacked" | "symbol" | "wordmark";
export type LogoTone = "auto" | "color-on-dark" | "color-on-light" | "mono-white" | "mono-black" | "mono-teal";

type LogoProps = {
  variant?: LogoVariant;
  tone?: LogoTone;
  /** Rendered height in px; width follows the file's aspect ratio. */
  height?: number;
  className?: string;
  /** Above-the-fold logo: preload instead of lazy-loading. */
  priority?: boolean;
  /** Pass "" when visible "HAKA PRO" text sits next to the logo; the image is then hidden from assistive tech. */
  alt?: string;
};

/** Intrinsic sizes from each file's viewBox (public/brand/svg/<variant>/*.svg). */
export const LOGO_VIEWBOX: Record<LogoVariant, { width: number; height: number }> = {
  horizontal: { width: 1642, height: 400 },
  stacked: { width: 935, height: 632 },
  symbol: { width: 400, height: 400 },
  wordmark: { width: 1161, height: 149 },
};

const DEFAULT_HEIGHT: Record<LogoVariant, number> = { horizontal: 32, stacked: 64, symbol: 32, wordmark: 16 };

/** Minimum rendered sizes from the logo guidelines (§05). Below them, switch to a smaller variant. */
const MIN_SIZE: Partial<Record<LogoVariant, { width: number }>> = {
  horizontal: { width: 120 },
  stacked: { width: 64 },
  symbol: { width: 24 },
};

export function logoSrc(variant: LogoVariant, tone: Exclude<LogoTone, "auto">) {
  // Symbol files have one full-color version, no on-dark/on-light split.
  const file = variant === "symbol" && tone.startsWith("color-") ? "color" : tone;
  return `/brand/svg/${variant}/hakapro-${variant}-${file}.svg`;
}

/**
 * HAKA PRO logo. Always rendered as an image (never inlined SVG: every file uses id="g" for its
 * gradient, so inlined copies collide). Never apply filters, transforms, shadows or recoloring.
 * `tone="auto"` renders both color variants and lets the nearest .dark/.light scope pick one, so the
 * server output is already correct (no flash, no useTheme).
 */
export function Logo({ variant = "horizontal", tone = "auto", height, className, priority = false, alt = "HAKA PRO" }: LogoProps) {
  const box = LOGO_VIEWBOX[variant];
  const h = height ?? DEFAULT_HEIGHT[variant];
  const w = Math.round((h * box.width) / box.height * 100) / 100;

  const min = MIN_SIZE[variant];
  if (process.env.NODE_ENV !== "production" && min && w < min.width) {
    console.warn(`<Logo variant="${variant}"> is ${w}px wide; the guidelines minimum is ${min.width}px. Use a smaller variant instead.`);
  }

  const common = {
    width: w,
    height: h,
    "aria-hidden": alt === "" ? true : undefined,
    draggable: false,
  };

  if (tone === "auto" && variant !== "symbol") {
    // Only one is displayed. A preload link would fetch both, so priority means eager + high instead;
    // the lazy hidden one is never fetched.
    const eager = priority ? { loading: "eager" as const, fetchPriority: "high" as const } : {};
    return (
      <>
        <Image {...common} {...eager} alt={alt} src={logoSrc(variant, "color-on-dark")} className={cn("logo-on-dark shrink-0 select-none", className)} />
        <Image {...common} {...eager} alt={alt} src={logoSrc(variant, "color-on-light")} className={cn("logo-on-light shrink-0 select-none", className)} />
      </>
    );
  }
  return <Image {...common} alt={alt} preload={priority} src={logoSrc(variant, tone === "auto" ? "color-on-dark" : tone)} className={cn("block shrink-0 select-none", className)} />;
}
