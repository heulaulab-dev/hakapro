/**
 * Resolves a CSS custom property (e.g. "--chart-up") to an rgb() string as seen from `element`,
 * so canvas-based charts follow the active (possibly scoped) theme. oklch values are converted by
 * painting one pixel, which works regardless of how the browser serializes computed colors.
 */
export function resolveCssColor(element: Element, variable: string, alpha = 1): string {
  const raw = getComputedStyle(element).getPropertyValue(variable).trim();
  if (!raw) return `rgba(128,128,128,${alpha})`;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return raw;
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = raw;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
  return `rgba(${r},${g},${b},${((a / 255) * alpha).toFixed(3)})`;
}

/** Calls `onChange` when the theme/density on <html> changes. */
export function observeTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-density"] });
  return () => observer.disconnect();
}
